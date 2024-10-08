import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { execCommand } from 'actions-utils/commands'
import { context, setOutput } from 'actions-utils/context'
import { isDirectory } from 'actions-utils/files'
import { getBooleanInput, getStringArrayInput, getStringInput } from 'actions-utils/inputs'
import { debug, notice, warning } from 'actions-utils/outputs'

import git, { type CommitObject } from 'isomorphic-git'
import http from 'isomorphic-git/http/node'
import slash from 'slash'
import { glob } from 'tinyglobby'

export interface Inputs {
  githubToken: string
  repository: string
  branch: string
  tag: string
  squash: boolean
  gitignore: boolean
  message: string
  directory: string
  include: string[]
  exclude: string[]
  clean: string[]
  impersonate: boolean
}

export const getInputs = (): Inputs => {
  const inputs = {
    githubToken: getStringInput('github-token', true),
    repository: getStringInput('repository', false, context.repo.repo),
    branch: getStringInput('branch', true),
    tag: getStringInput('tag', false),
    squash: getBooleanInput('squash', false),
    gitignore: getBooleanInput('gitignore', false),
    message: getStringInput('message', true),
    directory: getStringInput('directory', false, '.'),
    include: getStringArrayInput('include', false),
    exclude: getStringArrayInput('exclude', false),
    clean: getStringArrayInput('clean', false),
    impersonate: getBooleanInput('impersonate', false),
  }
  inputs.directory = slash(path.join(process.cwd(), inputs.directory))
  debug(`Inputs: ${JSON.stringify(inputs, null, 0)}`)
  return inputs
}

export const getFiles = async (directory: string, include: string[], exclude: string[]): Promise<string[]> => {
  include = include.length > 0 ? include : ['**/*']
  exclude = exclude.length > 0 ? exclude : []
  const files = await Promise.all(
    include.map((include) =>
      glob(include, {
        cwd: directory,
        ignore: exclude,
        followSymbolicLinks: false,
        onlyFiles: true,
        dot: true,
        absolute: false,
      })
    )
  )
  return files.flat()
}

export const getMessage = (template: string, commit: CommitObject): string => {
  return template
    .replaceAll('{hash}', commit.tree)
    .replaceAll('{shorthash}', commit.tree.slice(0, 7))
    .replaceAll('{message}', commit.message.trim() || 'no message')
    .trim()
}

export const getCommit = async (directory: string, ref = 'HEAD'): Promise<CommitObject> => {
  const root = await git.findRoot({
    fs,
    filepath: directory,
  })
  const head = await git.resolveRef({
    fs,
    dir: root,
    ref,
  })
  const commit = await git.readCommit({
    fs,
    dir: root,
    oid: head,
  })
  return commit.commit
}

export const squash = async (directory: string, reference: string): Promise<void> => {
  const temporary = `temp-${Math.random().toString(36).slice(2)}`
  await git.branch({
    fs,
    dir: directory,
    ref: temporary,
    checkout: true,
  })
  const branches = await git.listBranches({
    fs,
    dir: directory,
  })
  if (branches.includes(reference)) {
    await git.deleteBranch({
      fs,
      dir: directory,
      ref: reference,
    })
  }
  await execCommand('git', ['checkout', '--orphan', reference], { cwd: directory }, 'Failed to create orphan branch')
}

export interface ReleaseResult {
  branch: string
  tag?: string
  commit: string
  url: string
  files: string[]
  changed: string[]
}
export const main = async (inputsOverride?: Inputs, push = true): Promise<ReleaseResult> => {
  debug(`Context: ${JSON.stringify(context, null, 0)}`)

  const inputs = inputsOverride ?? getInputs()

  const url =
    inputs.githubToken === 'skip'
      ? `https://github.com/${inputs.repository}.git`
      : `https://x-access-token:${inputs.githubToken}@github.com/${inputs.repository}.git`

  const commit = await getCommit(process.cwd())
  const message = getMessage(inputs.message, commit)
  const author = inputs.impersonate
    ? {
        name: commit.author.name,
        email: commit.author.email,
      }
    : {
        name: 'github-actions[bot]',
        email: 'github-actions[bot]@users.noreply.github.com',
      }

  const temporary = slash(await fs.mkdtemp(path.join(os.tmpdir(), 'release-branch-')))

  debug(`Cloning "${url}" to "${temporary}"`)
  await git.clone({
    fs,
    http,
    dir: temporary,
    url,
  })

  const branches = await git.listBranches({
    fs,
    dir: temporary,
    remote: 'origin',
  })
  if (branches.includes(inputs.branch)) {
    debug(`Checking out existing branch "${inputs.branch}"`)
    await git.checkout({
      fs,
      dir: temporary,
      ref: inputs.branch,
    })
    if (inputs.squash) {
      debug(`Squashing branch "${inputs.branch}"`)
      await squash(temporary, inputs.branch)
    }
  } else {
    debug(`Creating new branch "${inputs.branch}"`)
    await execCommand('git', ['checkout', '--orphan', inputs.branch], { cwd: temporary }, 'Failed to create orphan branch')
  }
  debug(`Branch "${inputs.branch}" checked out`)

  const remove = await getFiles(temporary, inputs.clean, ['**/.git/**'])
  debug(`Files to remove: ${JSON.stringify(remove, null, 0)}`)

  const add = await getFiles(inputs.directory, inputs.include, inputs.exclude)
  debug(`Files to add: ${JSON.stringify(add, null, 0)}`)

  await execCommand('git', ['rm', '--force', '--', ...remove], { cwd: temporary }, 'Failed to remove files')

  const copied = (
    await Promise.allSettled(
      add.map(async (file) => {
        await fs.mkdir(path.join(temporary, path.dirname(file)), {
          recursive: true,
        })
        await fs.copyFile(path.join(inputs.directory, file), path.join(temporary, file))
      })
    )
  )
    .map((result, index) => {
      if (result.status === 'rejected') {
        warning(`Failed to add file ${add[index]}: ${(result as { reason?: string }).reason || 'unknown error'}`)
        return
      }
      return add[index]
    })
    .filter(Boolean) as string[]

  for (const file of copied) {
    await (inputs.gitignore
      ? execCommand(
          'git',
          ['check-ignore', '--', file],
          {
            cwd: temporary,
          },
          `Failed to check-ignore ${file}`
        )
          .then(() => {
            debug(`Ignoring file ${file}`)
            return
          })
          .catch(() => {
            debug(`Adding file ${file}`)
            return execCommand(
              'git',
              ['add', '--', file],
              {
                cwd: temporary,
              },
              `Failed to add file ${file}`
            )
          })
      : execCommand(
          'git',
          ['add', '--force', '--', file],
          {
            cwd: temporary,
          },
          `Failed to add file ${file}`
        ))
  }

  const status = await git.statusMatrix({
    fs,
    dir: temporary,
  })

  const files = status.filter((file) => file[2] !== 0)
  debug(`Committing ${files.length} files to "${inputs.branch}"`)

  const changed = status.filter((file) => file[1] !== file[2])
  if (changed.length === 0) {
    notice('No files changed in the release branch.')
    return {
      branch: inputs.branch,
      tag: inputs.tag,
      commit: '',
      url: '',
      files: files.map((file) => file[0]),
      changed: [],
    }
  }
  debug(
    `Changed files: ${JSON.stringify(
      changed.map((file) => file[0]),
      undefined,
      0
    )}`
  )

  if (files.length === 0) {
    warning(`No files to commit in ${inputs.directory}, the release branch will be empty.`)
  }

  const sha = await git.commit({
    fs,
    dir: temporary,
    message,
    author,
  })
  setOutput('commit', sha)

  if (inputs.tag) {
    debug(`Creating tag "${inputs.tag}"`)
    await git.tag({
      fs,
      dir: temporary,
      ref: inputs.tag,
      force: true,
    })
  }

  if (!push) {
    debug(`Skipping push, changes are located in "${temporary}"`)
    return {
      branch: inputs.branch,
      tag: inputs.tag,
      commit: sha,
      url: '',
      files: files.map((file) => file[0]),
      changed: changed.map((file) => file[0]),
    }
  }

  debug(`Pushing to "${url}#${inputs.branch}"`)
  await execCommand(
    'git',
    ['push', '-u', 'origin', '--force', `refs/heads/${inputs.branch}:refs/heads/${inputs.branch}`],
    {
      cwd: temporary,
    },
    `Failed to push to "${url}#${inputs.branch}"`
  )

  if (inputs.tag) {
    debug(`Pushing tag "${inputs.tag} to ${url}"`)
    await execCommand(
      'git',
      ['push', '-u', 'origin', '--force', `refs/tags/${inputs.tag}:refs/tags/${inputs.tag}`],
      {
        cwd: temporary,
      },
      `Failed to push tag "${inputs.tag} to ${url}"`
    )
  }

  if ((await isDirectory(temporary)) && temporary.startsWith(os.tmpdir())) {
    debug(`Removing "${temporary}"`)
    await fs.rm(temporary, { recursive: true, force: true })
  } else {
    debug(`Skipping removal of "${temporary}"`)
  }

  const branchUrl = `https://github.com/${inputs.repository}/tree/${inputs.tag || inputs.branch}`
  notice(`Released ${files.length} files to branch ${inputs.branch}${inputs.tag ? ` with tag ${inputs.tag}` : ''}: ${branchUrl}`)

  return {
    branch: inputs.branch,
    tag: inputs.tag,
    commit: sha,
    url: branchUrl,
    files: files.map((file) => file[0]),
    changed: changed.map((file) => file[0]),
  }
}
