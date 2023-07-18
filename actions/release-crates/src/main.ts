import path from 'node:path'

import { execCommand } from 'actions-utils/commands'
import { context, setOutput } from 'actions-utils/context'
import { getBooleanInput, getStringInput } from 'actions-utils/inputs'
import { debug, endGroup, info, notice, startGroup, warning } from 'actions-utils/outputs'

import fetch from 'node-fetch'
import semver from 'semver'
import slash from 'slash'

export interface Inputs {
  githubToken: string
  cratesToken: string
  tagCrate: string
  directory: string
  dryRun: boolean
  allowDirty: boolean
  arguments: string
  onlyNewest: boolean
}

export const getInputs = (): Inputs => {
  const inputs = {
    githubToken: getStringInput('github-token', true),
    cratesToken: getStringInput('crates-token', false),
    tagCrate: getStringInput('tag-crate', false),
    directory: getStringInput('directory', false, '.'),
    dryRun: getBooleanInput('dry-run', false),
    allowDirty: getBooleanInput('allow-dirty', false),
    arguments: getStringInput('arguments', false),
    onlyNewest: getBooleanInput('only-newest', false),
  }
  inputs.directory = slash(path.join(process.cwd(), inputs.directory))
  debug(`Inputs: ${JSON.stringify(inputs, null, 0)}`)
  return inputs
}

export const stringify = (value: unknown, indent: number = 0): string => {
  return JSON.stringify(
    value,
    (key, value) => {
      if (value instanceof Map) {
        return [...value]
      }
      if (value instanceof Set) {
        return [...value]
      }
      return value
    },
    indent
  )
}

export interface Dependency {
  name: string
  kind: string | null
  req: string
  path?: string
}

export interface Manifest {
  name?: string
  manifest_path: string
  version?: string
  publish?: string[]
  dependencies?: Dependency[]
}

export interface Metadata {
  packages?: Manifest[]
  workspace_root?: string
}

export interface Crate {
  path: string
  name: string
  version_string: string
  version: semver.SemVer
  publish: boolean
  files: Set<string>
  dependencies: Map<string, Dependency>
}

export interface Workspace {
  path: string
  crates: Map<string, Crate>
}

export const getPackages = async (directory: string): Promise<Workspace> => {
  const manifest = path.basename(directory) === 'Cargo.toml' ? directory : path.join(directory, 'Cargo.toml')
  const rawmetadata = await execCommand(
    'cargo',
    ['metadata', '--format-version', '1', '--no-deps', '--manifest-path', manifest],
    {},
    `Failed to get cargo metadata for ${manifest}`
  )
  let metadata: Metadata
  try {
    metadata = JSON.parse(rawmetadata)
  } catch (_error) {
    const error = _error as SyntaxError
    throw new Error(`Failed to parse cargo metadata: ${error.message}`)
  }
  if (!metadata.packages) {
    throw new Error(`Failed to parse cargo metadata, no packages: ${rawmetadata}`)
  }
  if (!metadata.workspace_root) {
    throw new Error(`Failed to parse cargo metadata, no workspace root: ${rawmetadata}`)
  }

  const workspace: Workspace = {
    path: metadata.workspace_root,
    crates: new Map<string, Crate>(),
  }

  for (const package_info of metadata.packages) {
    debug(`Package ${package_info.name}: ${stringify(package_info)}`)
    if (typeof package_info.name !== 'string' || package_info.name.trim() === '') {
      throw new TypeError(`Invalid package name: "${package_info.name}"`)
    }
    if (typeof package_info.version !== 'string' || package_info.version.trim() === '') {
      throw new TypeError(`Invalid package version: "${package_info.version}"`)
    }
    if (!Array.isArray(package_info.dependencies)) {
      throw new TypeError(`Invalid package dependencies: "${package_info.dependencies}"`)
    }
    const publish = package_info.publish?.includes('crates') ?? true
    const manifest_dir = path.dirname(package_info.manifest_path)
    const dependencies = new Map<string, Dependency>()
    for (const dependency_info of package_info.dependencies) {
      debug(`Dependency ${dependency_info.name}: ${stringify(dependency_info)}`)
      if (typeof dependency_info.name !== 'string' || dependency_info.name.trim() === '') {
        throw new TypeError(`Invalid dependency name: "${dependency_info.name}"`)
      }
      if (publish && dependency_info.kind !== 'dev' && dependency_info.req === '*') {
        throw new TypeError(`Invalid dependency version for ${dependency_info.name}: "${dependency_info.req}"`)
      }
      const dependency: Dependency = {
        name: dependency_info.name,
        kind: dependency_info.kind,
        req: dependency_info.req,
        path: dependency_info.path && path.relative(manifest_dir, dependency_info.path),
      }
      if (!dependencies.has(dependency_info.name) || dependencies.get(dependency_info.name)!.kind === 'dev') {
        dependencies.set(dependency_info.name, dependency)
      }
    }
    const rawfiles = await execCommand(
      'cargo',
      ['package', '--list', '--allow-dirty', '--manifest-path', package_info.manifest_path],
      {},
      `Failed to get cargo package list for ${package_info.manifest_path}`
    )
    const files = new Set<string>()
    for (const file of rawfiles.split('\n')) {
      if (file.trim() === '') {
        continue
      }
      files.add(file)
    }
    const version = semver.parse(package_info.version)
    if (!version) {
      throw new TypeError(`Invalid package version: "${package_info.version}"`)
    }
    const crate: Crate = {
      path: package_info.manifest_path,
      name: package_info.name,
      version_string: package_info.version,
      version,
      publish,
      files,
      dependencies,
    }
    workspace.crates.set(package_info.name, crate)
  }

  return workspace
}

export const sortPackages = (workspace: Workspace): string[] => {
  const sort = (names: string[], crates: Map<string, Crate>, start: string[], depth = 0): string[] => {
    const processed = names.reduce((prev, cur) => {
      if ([...crates.get(cur)!.dependencies.entries()].every(([n, d]) => d.kind === 'dev' || start.includes(n) || !crates.has(n))) {
        prev.push(cur)
      }
      return prev
    }, start)
    const next = names.filter((n) => !processed.includes(n))
    return next.length > 0 && depth <= crates.size ? sort(next, crates, processed, depth + 1) : processed
  }
  const names = [...workspace.crates.keys()]
  const crates = sort(names, workspace.crates, [])
  if (crates.length !== names.length) {
    throw new Error(
      `Failed to build workspace dependency graph due to cyclic dependencies: could not resolve ${stringify(
        names.filter((n) => !crates.includes(n))
      )}`
    )
  }
  for (let i = 0; i < crates.length - 1; ++i) {
    const crate = workspace.crates.get(crates[i]!)!
    for (let j = i + 1; j < crates.length; ++j) {
      const dependency = crate.dependencies.get(crates[j]!)
      if (dependency && dependency.kind !== 'dev') {
        throw new Error(`Cyclic dependency between "${crate.name}" and "${dependency.name}"`)
      }
    }
  }
  for (const crate of workspace.crates.values()) {
    for (const dependency of crate.dependencies.values()) {
      const dependency_crate = workspace.crates.get(dependency.name)
      if (dependency_crate && !dependency_crate.publish) {
        throw new Error(`"${crate.name}" depends on workspace member "${dependency.name}" which is not published`)
      }
      if (
        dependency_crate &&
        dependency_crate.version.major === 0 &&
        dependency_crate.version.minor === 0 &&
        dependency_crate.version.patch === 0
      ) {
        throw new Error(`"${crate.name}" depends on workspace member "${dependency.name}" which has version "0.0.0"`)
      }
    }
  }
  return crates
}

export interface CrateVersionInfo {
  num: string
  updated_at: string
}
export interface CrateInfo {
  crate: {
    id: string
    name: string
    created_at: string
    updated_at: string
    max_version: string
    newest_version: string
  }
  versions: CrateVersionInfo[]
}

export const getPublishedCrate = async (crate: Crate): Promise<CrateInfo | null> => {
  try {
    const response = await fetch(`https://crates.io/api/v1/crates/${crate.name}`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'release-crates-action',
      },
    })
    if (response.status === 404) {
      return null
    }
    if (!response.ok) {
      throw new Error(`Failed to get published version for crate "${crate.name}": ${response.statusText}`)
    }
    const data = (await response.json()) as CrateInfo | { crate: null } | null
    if (!data?.crate?.id) {
      debug(`Failed to get published version for crate "${crate.name}", invalid response: ${stringify(data)}`)
      throw new Error(`Failed to get published version for crate "${crate.name}", invalid response`)
    }
    return data
  } catch (_error) {
    const error = _error as Error
    debug(`Failed to get published version for crate "${crate.name}": ${error.message}`)
    throw error
  }
}

export const awaitPublishedCrate = async (crate: Crate, timeout: number = 60_000): Promise<CrateInfo> => {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    info(`Waiting for crate "${crate.name}" version "${crate.version_string}" to be published`)
    await new Promise((resolve) => {
      setTimeout(() => {
        resolve(null)
      }, 2000)
    })
    const published = await getPublishedCrate(crate)
    if (!published) {
      info(`Failed to get published version for crate "${crate.name}"`)
      continue
    }
    debug(`Published info for "${crate.name}": ${stringify(published.crate)}`)
    if (published.versions.some((version) => version.num === crate.version_string)) {
      info(`Crate "${crate.name}" version "${crate.version_string}" is published`)
      return published
    } else {
      info(
        `Crate "${crate.name}" version "${crate.version_string}" is not published, ` +
          `latest version is "${published.crate.newest_version}"`
      )
    }
  }
  throw new Error(`Failed to get published version for crate "${crate.name}" version "${crate.version_string}" within ${timeout}ms`)
}

export const publishCrate = async (
  crate: Crate,
  inputs: Inputs,
  root: string,
  env: Record<string, string>,
  push: boolean
): Promise<boolean> => {
  const published = await getPublishedCrate(crate)
  debug(`Published info for "${crate.name}": ${stringify(published?.crate)}`)

  if (published) {
    if (push && published.versions.some((version) => version.num === crate.version_string)) {
      info(`Skipping crate "${crate.name}" because version "${crate.version_string}" is already published`)
      return false
    }
    const published_version = semver.parse(published.crate.max_version)
    if (!published_version) {
      throw new TypeError(`Invalid published version for crate "${crate.name}": "${published.crate.max_version}"`)
    }
    if (inputs.onlyNewest && semver.lt(crate.version, published_version)) {
      info(`Skipping crate "${crate.name}" because it is not the newest version`)
      return false
    }
  }

  startGroup(`Publishing crate "${crate.name}" version "${crate.version_string}"${push ? '' : ' (dry-run)'}`)
  if (push) {
    notice(`Publishing crate "${crate.name}" version "${crate.version_string}"`)
  }
  const args = [
    'publish',
    '--package',
    crate.name,
    '--manifest-path',
    crate.path,
    ...(!push ? ['--dry-run'] : []),
    ...(inputs.allowDirty ? ['--allow-dirty'] : []),
    ...(inputs.arguments ? inputs.arguments.split(' ') : []),
  ]
  info(`Running "cargo ${args.join(' ')}" in "${root}"`)
  try {
    await execCommand(
      'cargo',
      args,
      {
        env,
        cwd: root,
      },
      `Failed to publish crate "${crate.name}"${push ? '' : ' (dry-run)'}`
    )
    if (!inputs.dryRun) {
      await (push ? awaitPublishedCrate(crate) : awaitPublishedCrate(crate, 10_000))
    }
  } finally {
    endGroup()
  }
  return true
}

export const checkCargo = async (): Promise<boolean> => {
  try {
    await execCommand('cargo', ['--version'], {}, 'Failed to get cargo version')
    return true
  } catch {
    return false
  }
}

export const main = async (inputsOverride?: Inputs, push = true) => {
  debug(`Context: ${stringify(context)}`)

  if (!(await checkCargo())) {
    throw new Error('Cargo could not be found. Please make sure it is installed and available in the PATH.')
  }

  const inputs = inputsOverride ?? getInputs()
  push = push && !inputs.dryRun

  if (push && !inputs.cratesToken) {
    throw new Error('Crates token is required for publishing crates')
  }

  const env = {
    ...(process.env as Record<string, string>),
    CARGO_REGISTRY_TOKEN: inputs.cratesToken.trim(),
  }

  const workspace = await getPackages(inputs.directory)
  debug(`Crates: ${stringify([...workspace.crates.keys()])}`)
  const sorted = sortPackages(workspace)
  info(`Processing ${sorted.length} crates: ${stringify(sorted)}`)

  const published_crates = new Set<string>()
  for (const crate_name of sorted) {
    const crate = workspace.crates.get(crate_name)!
    if (!crate.publish) {
      info(`Skipping crate "${crate.name}" because it is not published`)
      continue
    }
    if (crate.version.major === 0 && crate.version.minor === 0 && crate.version.patch === 0) {
      info(`Skipping crate "${crate.name}" because it has version "0.0.0"`)
      continue
    }
    try {
      const published = await publishCrate(crate, inputs, workspace.path, env, push)
      if (published) {
        published_crates.add(crate.name)
      }
    } catch (_error) {
      if (push) {
        throw _error
      }
      const error = _error as Error
      warning(`${error.message}`)
    }
  }

  if (inputs.tagCrate && published_crates.has(inputs.tagCrate)) {
    const crate = workspace.crates.get(inputs.tagCrate)!
    const tag = `v${crate.version_string}`
    info(`Creating tag "${tag}" for crate "${crate.name}" version "${crate.version_string}"${push ? '' : ' (dry-run)'}`)
    await execCommand(
      'git',
      ['tag', '-f', tag],
      {
        cwd: inputs.directory,
      },
      `Failed to create tag "${tag}" for crate "${crate.name}"`
    )
    if (push) {
      await execCommand(
        'git',
        ['push', '-u', 'origin', '--force', `refs/tags/${tag}:refs/tags/${tag}`],
        {
          cwd: inputs.directory,
        },
        `Failed to push tag "${tag}" for crate "${crate.name}"`
      )
    }
    setOutput('tag', tag)
    setOutput('version', crate.version_string)
  } else {
    setOutput('tag', '')
    setOutput('version', '')
  }

  setOutput('published', [...published_crates])

  if (push && published_crates.size > 0) {
    notice(`Published ${published_crates.size} crate${published_crates.size === 1 ? '' : 's'}: ${[...published_crates].join(', ')}`)
  }
}
