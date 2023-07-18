import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { execCommand } from 'actions-utils/commands'
import semver from 'semver'
import slash from 'slash'

import { Crate, Workspace, main, sortPackages } from './main'

describe('main', () => {
  const repository = `https://github.com/serde-rs/serde.git`
  const temporary = slash(fs.mkdtempSync(path.join(os.tmpdir(), 'release-branch-')))
  beforeAll(async () => {
    await execCommand('git', ['clone', repository, temporary], {}, `Failed to clone "${repository}" to "${temporary}"`)
  })
  it('should complete successfully', async () => {
    try {
      await expect(
        main(
          {
            githubToken: 'skip',
            cratesToken: 'skip',
            directory: temporary,
            dryRun: false,
            allowDirty: true,
            onlyNewest: false,
            tagCrate: 'serde',
            arguments: '',
          },
          false
        )
      ).resolves.toBeUndefined()
    } finally {
      if (fs.existsSync(temporary) && fs.lstatSync(temporary).isDirectory() && temporary.startsWith(os.tmpdir())) {
        fs.rmSync(temporary, { recursive: true, force: true })
      }
    }
  })
})

describe('crates', () => {
  it('should sort dependencies correctly', () => {
    const crates_config = [
      [
        'a',
        '0.0.1',
        [
          ['c', '0.0.1'],
          ['d', '0.0.1'],
        ],
      ],
      ['b', '0.0.1', []],
      ['c', '0.0.1', [['b', '0.0.1']]],
    ] as [string, string, [string, string][]][]
    const crates = new Map<string, Crate>()
    for (const [name, version, dependencies] of crates_config) {
      const crate: Crate = {
        name,
        files: new Set(),
        path: '',
        publish: true,
        version: semver.parse(version)!,
        version_string: version,
        dependencies: new Map(),
      }
      dependencies.forEach(([name, req]) => {
        crate.dependencies.set(name, {
          kind: null,
          name,
          req,
        })
      })
      crates.set(name, crate)
    }
    const workspace: Workspace = {
      path: '',
      crates,
    }
    const sorted = sortPackages(workspace)
    expect(sorted).toHaveLength(3)
    expect(sorted[0]).toBe('b')
    expect(sorted[1]).toBe('c')
    expect(sorted[2]).toBe('a')
  })
})
