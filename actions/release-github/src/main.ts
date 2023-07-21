import fs from 'node:fs/promises'
import path from 'node:path'

import type { GetResponseTypeFromEndpointMethod } from '@octokit/types'
import { execCommand } from 'actions-utils/commands'
import type { GitHub } from 'actions-utils/context'
import { context, getOctokit, setOutput } from 'actions-utils/context'
import { getBooleanInput, getStringArrayInput, getStringInput } from 'actions-utils/inputs'
import { debug, notice, warning } from 'actions-utils/outputs'

import { glob } from 'glob'
import mime from 'mime'
import fetch from 'node-fetch'

export type Octokit = InstanceType<typeof GitHub>

export interface Inputs {
  githubToken: string
  repository: string
  name: string
  tag: string
  prerelease: boolean
  draft: boolean
  files: string[]
  message?: string
  messageFile?: string
  messagePulls?: string
  messageCommits?: string
  compareTag: boolean
  compareLatest: boolean
  compareFirst: boolean
  useGitHubReleaseNotes: boolean
}

export type Release = GetResponseTypeFromEndpointMethod<Octokit['rest']['repos']['createRelease']>['data']
export type CompareCommit = GetResponseTypeFromEndpointMethod<Octokit['rest']['repos']['compareCommits']>['data']['commits'][0]
export type Commit = GetResponseTypeFromEndpointMethod<Octokit['rest']['git']['getCommit']>['data']
export type PullRequest = GetResponseTypeFromEndpointMethod<Octokit['rest']['pulls']['list']>['data'][0]
export type Ref = GetResponseTypeFromEndpointMethod<Octokit['rest']['git']['getRef']>['data']

export interface Repository {
  owner: string
  repo: string
}

export const getInputs = (): Inputs => {
  const inputs = {
    githubToken: getStringInput('github-token', true),
    repository: getStringInput('repository', false) || context.repo.repo,
    name: '',
    tag: getStringInput('tag', false),
    prerelease: getBooleanInput('prerelease', false),
    draft: getBooleanInput('draft', false),
    files: getStringArrayInput('files', false),
    message: getStringInput('message', false) || undefined,
    messageFile: getStringInput('message-file', false) || undefined,
    messagePulls: getStringInput('message-pulls', false) || undefined,
    messageCommits: getStringInput('message-commits', false) || undefined,
    compareTag: getBooleanInput('compare-tag', false),
    compareLatest: getBooleanInput('compare-latest', false),
    compareFirst: getBooleanInput('compare-first', false),
    useGitHubReleaseNotes: getBooleanInput('use-github-release-notes', false),
  }
  inputs.name = getStringInput('name', false) || inputs.tag
  if (!inputs.tag && context.ref.startsWith('refs/tags/')) {
    inputs.tag = context.ref.slice('refs/tags/'.length)
  }
  debug(`Inputs: ${JSON.stringify(inputs, null, 0)}`)
  return inputs
}

export const getFiles = async (files: string[]): Promise<string[]> => {
  const filesToRelease = await Promise.all(
    files.map((file) =>
      glob(file, {
        cwd: process.cwd(),
        nodir: true,
      })
    )
  )
  return filesToRelease.flat().filter((file, index, self) => self.indexOf(file) === index)
}

export const getCompareBase = async (
  gh: Octokit,
  repository: Repository,
  inputs: Inputs
): Promise<{ commit: Commit; release?: Release } | undefined> => {
  const { owner, repo } = repository
  let sha: string | undefined
  let release: Release | undefined
  if (inputs.compareTag) {
    debug(`Getting ref for tag "${inputs.tag}"`)
    try {
      sha = (
        await gh.rest.git.getRef({
          owner,
          repo,
          ref: `tags/${inputs.tag}`,
        })
      ).data.object.sha
      release = (
        await gh.rest.repos.getReleaseByTag({
          owner,
          repo,
          tag: inputs.tag,
        })
      ).data
    } catch (_error) {
      const error = _error as { status: number }
      if (error.status !== 404) {
        throw _error
      }
    }
  }
  if (inputs.compareLatest && (!sha || !release)) {
    debug(`Getting ref for latest release`)
    try {
      release = (
        await gh.rest.repos.getLatestRelease({
          owner,
          repo,
        })
      ).data
      debug(`Latest release: ${JSON.stringify(release, null, 0)}`)
      sha = (
        await gh.rest.git.getRef({
          owner,
          repo,
          ref: `tags/${release.tag_name}`,
        })
      ).data.object.sha
    } catch (_error) {
      const error = _error as { status: number }
      if (error.status !== 404) {
        throw _error
      }
    }
  }
  if (inputs.compareFirst && (!sha || !release)) {
    debug(`Getting ref for first commit`)
    await execCommand(
      'git',
      ['fetch', '--unshallow'],
      {
        cwd: process.cwd(),
      },
      `Failed to fetch all commits`
    )
    sha = await execCommand(
      'git',
      ['rev-list', '--max-parents=0', 'HEAD'],
      {
        cwd: process.cwd(),
      },
      `Failed to get first commit`
    )
  }
  if (!sha) {
    return undefined
  }
  debug(`Getting commit for ref "${sha}"`)
  try {
    const commit = await gh.rest.git.getCommit({
      owner,
      repo,
      commit_sha: sha,
    })
    return { commit: commit.data, release }
  } catch {
    return undefined
  }
}

const getPullsForCommits = async (
  gh: Octokit,
  repository: Repository,
  commits: CompareCommit[]
): Promise<Record<string, PullRequest[]>> => {
  const { owner, repo } = repository
  const pulls: [string, PullRequest[]][] = await Promise.all(
    commits.map(async (commit) => {
      const pulls = []
      let page = 0
      while (page >= 0) {
        const associated = await gh.rest.repos.listPullRequestsAssociatedWithCommit({
          owner,
          repo,
          commit_sha: commit.sha,
          per_page: 100,
        })
        pulls.push(...associated.data)
        if (associated.headers.link?.includes('rel="next"')) {
          page += 1
        } else {
          page = -1
        }
      }
      return [commit.sha, pulls]
    })
  )
  return pulls.reduce<Record<string, PullRequest[]>>((acc, [sha, pulls]) => {
    acc[sha] = pulls
    return acc
  }, {})
}

export const getReleaseBody = async (gh: Octokit, repository: Repository, inputs: Inputs, target: string): Promise<string> => {
  const { owner, repo } = repository
  let body = inputs.message || ''
  if (inputs.messageFile) {
    if (!(await fs.stat(inputs.messageFile)).isFile()) {
      throw new Error(`Message file "${inputs.messageFile}" is not a file`)
    }
    body += '\n\n' + (await fs.readFile(inputs.messageFile)).toString()
  }
  body = body.trim()

  if (inputs.useGitHubReleaseNotes) {
    body += '\n\n'
    return body
  }

  const compareBase = await getCompareBase(gh, repository, inputs)
  if (!compareBase) {
    debug(`No ref to compare with found`)
  } else {
    const { commit: compareBaseCommit, release: compareBaseRelease } = compareBase
    debug(`Getting commits between ${compareBaseCommit.sha} and ${target}`)
    const commits = []
    let page = 0
    while (page >= 0) {
      const compare = await gh.rest.repos.compareCommits({
        owner,
        repo,
        base: compareBaseCommit.sha,
        head: target,
        per_page: 100,
        page,
      })
      commits.push(
        ...compare.data.commits
          .filter((commit) => !commit.commit.message.startsWith('Merge pull request #'))
          .filter((commit) => !commit.commit.message.startsWith('Merge branch '))
      )
      if (compare.headers.link?.includes('rel="next"')) {
        page += 1
      } else {
        page = -1
      }
    }

    const pullsForCommits = await getPullsForCommits(gh, repository, commits)
    const pulls = Object.values(pullsForCommits).flat()
    if (inputs.messagePulls && inputs.messagePulls.length > 0 && pulls.length > 0) {
      body += '\n\n### Pull Requests\n'
      const messagePulls = inputs.messagePulls
      body += pulls
        .filter((pull, index, self) => self.findIndex((p) => p.id === pull.id) === index)
        .map((pull) => {
          const author = pull.user?.name || 'Anonymous'
          const user = pull.user?.login ? `@${pull.user.login}` : author
          const number = '#' + pull.number.toString()
          const title = pull.title.trim()
          return messagePulls
            .replaceAll('({author})', author ? `(${author})` : '')
            .replaceAll('{author}', author)
            .replaceAll('({user})', user ? `(${user})` : '')
            .replaceAll('{user}', user)
            .replaceAll('({pull})', number ? `(${number})` : '')
            .replaceAll('{pull}', number)
            .replaceAll('({title})', title ? `(${title})` : '')
            .replaceAll('{title}', title)
            .trim()
        })
        .join('\n')
      body = body.trim()
    }

    if (inputs.messageCommits && inputs.messageCommits.length > 0 && commits.length > 0) {
      body += '\n\n### Commits\n'
      const messageCommits = inputs.messageCommits
      body += commits
        .map((commit) => {
          const lines = commit.commit.message.trim().split('\n')
          const message = lines.shift()?.trim() || ''
          const body = lines
            .map((line) => line.trim())
            .filter((line) => !line.startsWith('#'))
            .filter((line) => line.length > 0)
            .join('\n')
            .trim()
          const author = commit.commit.author?.name || 'Anonymous'
          const user = commit.author?.login ? `@${commit.author.login}` : author
          const hash = commit.sha
          const shorthash = hash.slice(0, 7)
          const pull = Object.entries(pullsForCommits).find(([sha]) => sha === hash)?.[1][0]?.number || undefined
          return messageCommits
            .replaceAll('({message})', message ? `(${message})` : '')
            .replaceAll('{message}', message)
            .replaceAll('({body})', body ? `(${body})` : '')
            .replaceAll('{body}', body)
            .replaceAll('({author})', author ? `(${author})` : '')
            .replaceAll('{author}', author)
            .replaceAll('({user})', user ? `(${user})` : '')
            .replaceAll('{user}', user)
            .replaceAll('({hash})', hash ? `(${hash})` : '')
            .replaceAll('{hash}', hash)
            .replaceAll('({shorthash})', shorthash ? `(${shorthash})` : '')
            .replaceAll('{shorthash}', shorthash)
            .replaceAll('({pull})', pull ? `(#${pull})` : '')
            .replaceAll('{pull}', pull ? `#${pull}` : '')
            .split('\n')
            .map((line) => line.trimEnd())
            .join('\n')
            .trim()
        })
        .join('\n')
      body = body.trim()
    }
    const compareUrl = new URL(compareBaseCommit.html_url.replace('/commit/', '/compare/') + '...' + target).toString()
    if (compareBaseRelease) {
      const formattedDate = new Date(compareBaseRelease.created_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
      const formattedBase = compareBaseRelease.name || compareBaseRelease.tag_name
      body += `\n\n**Compare all changes since ${formattedDate} (${formattedBase})**: ${compareUrl}`
    } else {
      body += `\n\n**Compare all changes**: ${compareUrl}`
    }
  }

  return body.trim()
}

export const createRelease = async (
  gh: Octokit,
  repository: Repository,
  inputs: Inputs,
  body: string,
  target: string
): Promise<Release> => {
  const { owner, repo } = repository
  try {
    const existingRelease = await gh.rest.repos.getReleaseByTag({
      owner,
      repo,
      tag: inputs.tag,
    })
    debug(`Deleting existing release: ${JSON.stringify(existingRelease.data, null, 0)}`)
    await gh.rest.repos.deleteRelease({
      owner,
      repo,
      release_id: existingRelease.data.id,
    })
  } catch (_error) {
    const error = _error as { status: number }
    if (error.status !== 404) {
      throw _error
    }
  }
  const data = {
    target_commitish: target,
    tag_name: inputs.tag,
    name: inputs.name,
    prerelease: inputs.prerelease,
    draft: inputs.draft,
    generate_release_notes: inputs.useGitHubReleaseNotes,
    body,
  }
  const existingTagSha = await gh.rest.git
    .getRef({
      owner,
      repo,
      ref: `tags/${inputs.tag}`,
    })
    .then((response) => response.data.object.sha)
    .catch(() => undefined)
  if (!context.ref.startsWith('refs/tags/') && existingTagSha !== target) {
    if (existingTagSha) {
      debug(`Overwriting existing tag "${inputs.tag}" pointing to "${existingTagSha}" with "${target}"`)
    } else {
      debug(`Creating new tag "${inputs.tag}" pointing to "${target}"`)
    }
    await execCommand(
      'git',
      ['tag', '-f', inputs.tag, target],
      {
        cwd: process.cwd(),
      },
      `Failed to create tag "${inputs.tag}"`
    )
    await execCommand(
      'git',
      ['push', '-u', 'origin', '--force', `refs/tags/${inputs.tag}:refs/tags/${inputs.tag}`],
      {
        cwd: process.cwd(),
      },
      `Failed to push tag "${inputs.tag}" to origin`
    )
  }
  debug(`Creating new release: ${JSON.stringify(data, null, 0)}`)
  const release = await gh.rest.repos.createRelease({
    ...data,
    owner,
    repo,
  })
  return release.data
}

export const cleanUploadUrl = (uploadUrl: string): string => {
  const bracketIndex = uploadUrl.indexOf('{')
  if (bracketIndex > 0) {
    return uploadUrl.slice(0, Math.max(0, bracketIndex))
  }
  return uploadUrl
}

export const uploadAssets = async (inputs: Inputs, release: Release, files: string[]): Promise<Record<string, any>> => {
  return Promise.all(
    files.map(async (file) => {
      const name = path.basename(file)
      const contentType = mime.getType(file) || 'application/octet-stream'
      const contentStat = await fs.stat(file)
      const contentLength = contentStat.size
      const content = await fs.readFile(file)
      const headers = {
        'content-length': `${contentLength}`,
        'content-type': `${contentType}`,
        'authorization': `token ${inputs.githubToken}`,
        'accept': 'application/vnd.github+json',
      }
      const url = new URL(cleanUploadUrl(release.upload_url))
      url.searchParams.append('name', name)
      debug(`Uploading asset: ${JSON.stringify({ url, headers, contentLength, contentType, name }, null, 0)}`)
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: content,
      })
      if (!response.ok) {
        throw new Error(`Failed to upload asset: ${response.statusText}`)
      }
      return response.json() as Promise<Record<string, any>>
    })
  )
}

export const main = async (inputsOverride?: Inputs, push = true) => {
  debug(`Context: ${JSON.stringify(context, null, 0)}`)

  const inputs = inputsOverride ?? getInputs()

  if (inputs.tag.length === 0) {
    warning('No tag found to release')
    return
  }
  if (inputs.repository.split('/').length !== 2) {
    throw new Error(`Invalid repository input "${inputs.repository}", expected format "<owner>/<repo>"`)
  }
  const repository = {
    owner: inputs.repository.split('/')[0],
    repo: inputs.repository.split('/')[1],
  } as Repository
  debug(`Target repository: ${JSON.stringify(repository, null, 0)}`)

  const files = await getFiles(inputs.files)
  if (files.length === 0) {
    warning('No files found to release')
    return
  }
  debug(`Files to release: ${JSON.stringify(files, null, 0)}`)
  const deduped = files.filter((file, index, self) => {
    const name = path.basename(file)
    return self.findIndex((f) => path.basename(f) === name) === index
  })
  if (files.length !== deduped.length) {
    warning(`Skipped ${files.length - deduped.length} files with duplicate base names`)
  }

  if (inputs.githubToken === 'skip') {
    debug(`Skipping release ${inputs.name} (${inputs.tag}) with ${deduped.length} assets`)
    return
  }

  const gh = getOctokit(inputs.githubToken)

  const contextSha = await gh.rest.repos
    .getCommit({
      owner: context.repo.owner,
      repo: context.repo.repo,
      ref: context.sha,
    })
    .then((response) => response.data.sha)
  debug(`Resolved context SHA "${context.sha}" to "${contextSha}"`)

  const body = await getReleaseBody(gh, repository, inputs, contextSha)
  debug(`Release body: ${body}`)
  if (!push) {
    debug(`Skipping push for release ${inputs.name} (${inputs.tag}) with ${deduped.length} assets`)
    return
  }

  const release = await createRelease(gh, repository, inputs, body, contextSha)
  debug(`Created release: ${JSON.stringify(release, null, 0)}`)
  setOutput('id', release.id.toString())
  setOutput('html-url', release.html_url)
  setOutput('upload-url', cleanUploadUrl(release.upload_url))

  const assets = await uploadAssets(inputs, release, deduped)
  debug(`Uploaded assets: ${JSON.stringify(assets, null, 0)}`)

  notice(`Created release ${release.name || release.id} (${release.tag_name}) with ${deduped.length} assets: ${release.html_url}`)
}
