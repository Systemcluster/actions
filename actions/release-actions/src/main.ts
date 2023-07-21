import fs from 'node:fs/promises'
import path from 'node:path'

import { getStringInput } from 'actions-utils/inputs'
import { debug, summary } from 'actions-utils/outputs'

import { glob } from 'glob'
import { getCommit, main as releaseBranchMain, ReleaseResult } from 'release-branch'

export interface ActionReleaseResult extends ReleaseResult {
  action: string
}
export interface ActionReleaseResults {
  results: ActionReleaseResult[]
  summary: string
}
export const main = async (push = true): Promise<ActionReleaseResults> => {
  const results = [] as ActionReleaseResult[]
  for (const file of await glob('./**/action.yml', {
    nodir: true,
    ignore: ['**/node_modules/**', '**/dist/**'],
    absolute: true,
  })) {
    const dir = path.dirname(file)
    const dirname = path.basename(dir)
    const packageJson = JSON.parse(
      await fs.readFile(path.join(dir, 'package.json'), {
        encoding: 'utf8',
      })
    ) as { version?: string; name?: string; displayName?: string }
    const name = packageJson.displayName ?? packageJson.name ?? dirname
    const version = (packageJson.version ?? '0.0.0').split('.')
    const versionTag = dirname + '-v' + (version[0] ?? 0)
    const result = await releaseBranchMain(
      {
        branch: dirname,
        directory: dir,
        include: ['**/*'],
        exclude: [
          '**/src/**',
          '**/node_modules/**',
          '**/coverage/**',
          '**/.turbo/**',
          '**/.swc/**',
          '**/*.test.*',
          '**/tsconfig.tsbuildinfo',
          '**/jest.config.js',
          '**/jest.setup.js',
          '**/rollup.config.js',
        ],
        clean: ['**/*'],
        squash: true,
        gitignore: true,
        githubToken: getStringInput('github-token', true),
        impersonate: false,
        message: (await getCommit(dir)).message,
        repository: getStringInput('repository', true),
        tag: versionTag,
      },
      push
    )
    results.push({
      ...result,
      action: name,
    })
  }

  if (results.length > 0) {
    summary.addHeading(`Released ${results.length} Actions 🎉`, 2)
    summary.addRaw('<ul>')
    results.forEach((result) =>
      summary
        .addRaw('<li>')
        .addLink(result.action, result.url)
        .addRaw(` with ${result.files.length} files (${result.changed.length} changed)`)
        .addRaw('</li>')
        .addEOL()
    )
    summary.addRaw('</ul>')
  }
  const summaryString = summary.stringify()
  if (process.env.GITHUB_STEP_SUMMARY) {
    await (push ? summary.write() : summary.clear())
  }

  const result = {
    results,
    summary: summaryString,
  }
  debug(`Result: ${JSON.stringify(result)}`)
  return result
}
