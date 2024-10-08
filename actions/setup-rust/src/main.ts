import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import url from 'node:url'

import toml from '@ltd/j-toml'

import { downloadTool, extractTar, extractZip, isCacheAvailable, restoreCache, saveCache } from 'actions-utils/cache'
import { execCommand, spawnCommand } from 'actions-utils/commands'
import { addPath, context, exportVariable, getState, saveState, setOutput } from 'actions-utils/context'
import { isDirectory, isFile } from 'actions-utils/files'
import { getBooleanInput, getStringArrayInput, getStringInput } from 'actions-utils/inputs'
import { debug, endGroup, info, startGroup, warning } from 'actions-utils/outputs'

import libc from 'detect-libc'
import slash from 'slash'
import { glob } from 'tinyglobby'

export interface Inputs {
  channel: string
  components: string[]
  targets: string[]
  profile: string
  binaries: string[]
  directory: string
  sccache: boolean
  cache: boolean
  cacheProfile: string
  cacheSweep: boolean
  cacheKeyJob: boolean
  cacheKeyEnv: string[]
}

export const getInputs = (): Inputs => {
  const inputs = {
    channel: getStringInput('channel', false),
    components: getStringArrayInput('components', false),
    targets: getStringArrayInput('targets', false),
    profile: getStringInput('profile', false),
    binaries: getStringArrayInput('binaries', false),
    directory: getStringInput('directory', false, '.'),
    sccache: getBooleanInput('cache-sccache', false, true),
    cache: getBooleanInput('cache', false, true),
    cacheProfile: getStringInput('cache-profile', false),
    cacheSweep: getBooleanInput('cache-sweep', false),
    cacheKeyJob: getBooleanInput('cache-key-job', false),
    cacheKeyEnv: getStringArrayInput('cache-key-env', false),
  }
  inputs.components = inputs.components.flatMap((component) => component.split(/[,;]+/u).map((component) => component.trim()))
  inputs.targets = inputs.targets.flatMap((target) => target.split(/[,;]+/u).map((target) => target.trim()))
  inputs.binaries = inputs.binaries.flatMap((binary) => binary.split(/[,;]+/u).map((binary) => binary.trim()))
  inputs.directory = slash(path.join(process.cwd(), inputs.directory))
  return inputs
}

export const stringify = (value: unknown, indent = 0): string => {
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

export interface Toolchain {
  channel: string
  components: string[]
  targets: string[]
  profile: string
}

export const parseToolchainFile = async (filePath: string): Promise<Partial<Toolchain>> => {
  const toolchainToml = await fs.readFile(filePath, 'utf8')
  const toolchain = toml.parse(toolchainToml, 1, '\n') as {
    toolchain: Partial<Toolchain>
  }
  return toolchain.toolchain
}

export const getToolchain = async (inputs: Inputs): Promise<Toolchain> => {
  const toolchain: Toolchain = {
    channel: 'stable',
    components: [],
    targets: [],
    profile: 'minimal',
  }
  if (process.env.RUSTUP_TOOLCHAIN) {
    debug(`Using toolchain channel from environment variable: "${process.env.RUSTUP_TOOLCHAIN}"`)
    toolchain.channel = process.env.RUSTUP_TOOLCHAIN
  } else {
    const toolchainTomlPath = path.join(inputs.directory, 'rust-toolchain.toml')
    const toolchainNamePath = path.join(inputs.directory, 'rust-toolchain')
    if (await isFile(toolchainTomlPath)) {
      debug(`Using toolchain from file: "${toolchainTomlPath}"`)
      const toolchainToml = await parseToolchainFile(toolchainTomlPath)
      if (toolchainToml.channel) {
        toolchain.channel = toolchainToml.channel
      }
      if (toolchainToml.components && toolchainToml.components.length > 0) {
        toolchain.components = [...toolchainToml.components]
      }
      if (toolchainToml.targets && toolchainToml.targets.length > 0) {
        toolchain.targets = [...toolchainToml.targets]
      }
      if (toolchainToml.profile) {
        toolchain.profile = toolchainToml.profile
      }
    } else if (await isFile(toolchainNamePath)) {
      debug(`Using toolchain from file: "${toolchainNamePath}"`)
      toolchain.channel = (await fs.readFile(toolchainNamePath, 'utf8')).trim()
    }
  }
  if (inputs.channel) {
    debug(`Using toolchain channel from input: "${inputs.channel}"`)
    toolchain.channel = inputs.channel
  }
  if (inputs.components.length > 0) {
    debug(`Using toolchain components from input: "${inputs.components.join(', ')}"`)
    toolchain.components.push(...inputs.components)
  }
  if (inputs.targets.length > 0) {
    debug(`Using toolchain targets from input: "${inputs.targets.join(', ')}"`)
    toolchain.targets.push(...inputs.targets)
  }
  if (inputs.profile) {
    debug(`Using toolchain profile from input: "${inputs.profile}"`)
    toolchain.profile = inputs.profile
  }
  if (!toolchain.channel) {
    debug(`Using default toolchain channel: "stable"`)
    toolchain.channel = 'stable'
  }
  if (!toolchain.profile) {
    debug(`Using default toolchain profile: "minimal"`)
    toolchain.profile = 'minimal'
  }
  return toolchain
}

export const installToolchain = async (toolchain: Toolchain): Promise<void> => {
  startGroup(`Installing toolchain "${toolchain.channel}"`)
  const args = ['toolchain', 'install', toolchain.channel, '--profile', toolchain.profile, '--no-self-update']
  for (const component of toolchain.components) {
    args.push('--component', component)
  }
  for (const target of toolchain.targets) {
    args.push('--target', target)
  }
  if (toolchain.channel === 'nightly') {
    args.push('--allow-downgrade')
  }
  try {
    await spawnCommand('rustup', args)
    await spawnCommand('rustup', ['default', toolchain.channel])
  } finally {
    endGroup()
  }
}

export const installBinstall = async (target: string): Promise<void> => {
  let arch = ''
  switch (os.arch()) {
    case 'x64': {
      arch = 'x86_64'
      break
    }
    case 'arm': {
      arch = 'armv7'
      break
    }
    case 'arm64': {
      arch = 'aarch64'
      break
    }
    default: {
      throw new Error(`Unknown architecture ${os.arch()}`)
    }
  }
  let downloadFileName = ''
  switch (os.platform()) {
    case 'linux': {
      let lib = 'gnu'
      if ((await libc.family()) === 'musl') {
        lib = 'musl'
      }
      if (os.arch() === 'arm') {
        lib += 'eabihf'
      }
      downloadFileName = `${arch}-unknown-linux-${lib}.tgz`
      break
    }
    case 'darwin': {
      downloadFileName = `${arch}-apple-darwin.zip`
      break
    }
    case 'win32': {
      downloadFileName = `${arch}-pc-windows-msvc.zip`
      break
    }
    default: {
      throw new Error(`Unknown platform ${process.platform}`)
    }
  }
  const url = `https://github.com/cargo-bins/cargo-binstall/releases/latest/download/cargo-binstall-${downloadFileName}`
  const tempDirectory = process.env.RUNNER_TEMP || path.join(os.tmpdir(), `setup-binstall`)
  const downloadPath = path.join(tempDirectory, downloadFileName)
  if (!(await isFile(downloadPath))) {
    debug(`Downloading cargo-binstall from "${url}" to "${downloadPath}"`)
    await downloadTool(url, downloadPath)
  } else {
    debug(`cargo-binstall already downloaded to "${downloadPath}"`)
  }
  if (downloadPath.endsWith('.zip')) {
    await extractZip(downloadPath, target)
  } else if (downloadPath.endsWith('.tgz')) {
    await extractTar(downloadPath, target)
  } else {
    throw new Error(`Unknown archive type ${downloadPath}`)
  }
}

export interface RustVersion {
  version: string
  hash: string
}
export const getRustVersion = async (): Promise<RustVersion> => {
  const rustcVersion = await execCommand('rustc', ['--version', '--verbose'])
  const rustcVersionMatch = /^rustc ([^ ]+) \(([^)]+)\)$/mu.exec(rustcVersion)
  if (!rustcVersionMatch || rustcVersionMatch.length !== 3) {
    throw new Error(`Unknown rustc version format: "${rustcVersion}"`)
  }
  return {
    version: rustcVersionMatch[1]!,
    hash: rustcVersionMatch[2]!,
  }
}

export const installBinaries = async (binaries: string[]): Promise<void> => {
  startGroup(`Installing binaries [${binaries.join(', ')}]`)
  try {
    await spawnCommand('cargo', ['binstall', '--no-confirm', '--log-level', 'info', ...binaries])
  } finally {
    endGroup()
  }
}

export interface CacheKey {
  exact: string
  partial: string[]
}
export const getCacheKey = async (
  inputs: Inputs,
  projectDirectory: string,
  toolchain: Toolchain,
  version: RustVersion
): Promise<CacheKey> => {
  const hasher = crypto.createHash('sha256')
  hasher.update(toolchain.channel)
  hasher.update(version.version)
  hasher.update(version.hash)
  const lockfilePaths = (
    await glob('**/Cargo.lock', {
      cwd: projectDirectory,
      absolute: true,
      onlyFiles: true,
      ignore: ['**/target/**'],
    })
  ).map((file) => slash(file))
  for (const cachePath of lockfilePaths) {
    if (await isFile(cachePath)) {
      const cargoLock = await fs.readFile(cachePath, 'utf8')
      hasher.update(cargoLock)
      debug(`Hashed file "${cachePath}"`)
    }
  }
  const cargoTomlPaths = (
    await glob('**/Cargo.toml', {
      cwd: projectDirectory,
      absolute: true,
      onlyFiles: true,
      ignore: ['**/target/**'],
    })
  ).map((file) => slash(file))
  for (const cachePath of cargoTomlPaths) {
    if (await isFile(cachePath)) {
      const cargoToml = await fs.readFile(cachePath, 'utf8')
      const cargo = toml.parse(cargoToml, 1, '\n') as {
        dependencies?: Record<string, unknown>
        workspace?: { dependencies?: Record<string, unknown> }
      }
      const dependencies = cargo.dependencies ?? []
      const workspaceDependencies = cargo.workspace?.dependencies ?? []
      hasher.update(stringify(dependencies))
      hasher.update(stringify(workspaceDependencies))
      debug(`Hashed dependencies from "${cachePath}"`)
    }
  }
  if (inputs.cacheKeyJob) {
    hasher.update(process.env.GITHUB_JOB || '')
    debug(`Hashed job id "${process.env.GITHUB_JOB || ''}"`)
  }
  if (inputs.cacheKeyEnv.length > 0) {
    for (const env of inputs.cacheKeyEnv) {
      const value = process.env[env]
      if (value) {
        hasher.update(value)
        debug(`Hashed env "${env}"`)
      }
    }
  }
  const hash = hasher.digest('hex')
  return {
    exact: `setup-rust-${os.platform()}-${os.arch()}-${hash}`,
    partial: [`setup-rust-${os.platform()}-${os.arch()}-`],
  }
}

export const restoreCargoCache = async (
  projectDirectory: string,
  cargoDirectory: string,
  cacheKey: CacheKey
): Promise<string | undefined> => {
  if (!isCacheAvailable()) {
    info('Cache feature is not available on this runner, not saving cache')
    return
  }
  const directories = []
  const registryPath = path.normalize(path.join(cargoDirectory, 'registry'))
  const targetPath = path.normalize(path.join(projectDirectory, 'target'))
  const cwdRoot = path.parse(process.cwd()).root
  if (path.parse(registryPath).root !== cwdRoot) {
    info('Cache path is not in the current drive, restoring registry to temporary directory')
    const tempDir = path.normalize(path.join(process.cwd(), '..', 'setup-rust-cargo-registry'))
    await fs.mkdir(tempDir, { recursive: true })
    directories.push(tempDir)
  } else {
    directories.push(registryPath)
  }
  directories.push(targetPath)
  debug(`Restoring directories [${directories.join(', ')}]`)
  const cacheHit = await restoreCache(directories, cacheKey.exact, cacheKey.partial)
  if (cacheHit && path.parse(registryPath).root !== cwdRoot) {
    info('Copying registry from temporary directory')
    const tempDir = path.normalize(path.join(process.cwd(), '..', 'setup-rust-cargo-registry'))
    // eslint-disable-next-line n/no-unsupported-features/node-builtins
    await fs.cp(tempDir, registryPath, { recursive: true })
  }
  return cacheHit
}

export const saveCargoCache = async (projectDirectory: string, cargoDirectory: string, cacheKey: string): Promise<number> => {
  const directories = []
  const registryPath = path.normalize(path.join(cargoDirectory, 'registry'))
  const targetPath = path.normalize(path.join(projectDirectory, 'target'))
  const cwdRoot = path.parse(process.cwd()).root
  if (await isDirectory(registryPath)) {
    if (path.parse(registryPath).root !== cwdRoot) {
      info('Cache path is not in the current drive, copying registry to temporary directory')
      const tempDir = path.normalize(path.join(process.cwd(), '..', 'setup-rust-cargo-registry'))
      await fs.mkdir(tempDir, { recursive: true })
      // eslint-disable-next-line n/no-unsupported-features/node-builtins
      await fs.cp(registryPath, tempDir, { recursive: true })
      directories.push(tempDir)
    } else {
      directories.push(registryPath)
    }
  }
  if (await isDirectory(targetPath)) {
    directories.push(targetPath)
  }
  if (directories.length === 0) {
    info('No directories to cache, not saving cache')
    return -1
  }
  debug(`Caching directories [${directories.join(', ')}]`)
  if (!isCacheAvailable()) {
    info('Cache feature is not available on this runner, not saving cache')
    return -1
  }
  const cacheId = await saveCache(directories, cacheKey)
  return cacheId
}

export const pruneCargoCache = async (cargoDirectory: string): Promise<void> => {
  if (!isCacheAvailable()) {
    info('Cache feature is not available on this runner, not pruning cache')
    return
  }
  startGroup(`Pruning cargo cache`)
  try {
    const args = ['cache', '--autoclean']
    await spawnCommand('cargo', args)
    const indexDir = path.join(cargoDirectory, 'registry', 'index')
    if (await isDirectory(indexDir)) {
      await Promise.all(
        (await fs.readdir(indexDir)).map(async (dir) => {
          if (await isDirectory(path.join(indexDir, dir, '.git'))) {
            debug(`Removing directory "${path.join(indexDir, dir, '.git')}"`)
            await fs.rm(path.join(indexDir, dir, '.cache'), {
              recursive: true,
            })
          }
        })
      )
    }
  } finally {
    endGroup()
  }
}

export const pruneTargetDirectory = async (inputs: Inputs, projectDirectory: string): Promise<void> => {
  if (!isCacheAvailable()) {
    info('Cache feature is not available on this runner, not pruning target')
    return
  }
  startGroup(`Pruning target directory "${projectDirectory}/target"`)
  try {
    if (inputs.cacheSweep) {
      debug(`Pruning outdated artifacts`)
      const args = ['sweep', '--installed', '--verbose']
      await spawnCommand('cargo', args, { cwd: projectDirectory })
    }
    if (inputs.cacheProfile) {
      const dirs = (
        await glob('**/', {
          cwd: path.join(projectDirectory, 'target'),
          absolute: true,
          onlyDirectories: true,
          deep: 1,
          ignore: [`**/${inputs.cacheProfile}`],
        })
      ).map((dir) => slash(dir))
      debug(`Removing all targets except "${inputs.cacheProfile}"`)
      await Promise.all(
        dirs.map(async (dir) => {
          if ((await isDirectory(dir)) && dir !== path.join(projectDirectory, 'target')) {
            debug(`Removing directory "${dir}"`)
            await fs.rm(dir, { recursive: true })
          }
        })
      )
    }
    debug(`Removing example and incremental directories`)
    const targets = (
      await glob('**/', {
        cwd: path.join(projectDirectory, 'target'),
        absolute: true,
        onlyDirectories: true,
        deep: 1,
      })
    ).map((dir) => slash(dir))
    await Promise.all(
      targets.map(async (target) =>
        Promise.all(
          ['examples', 'incremental'].map(async (dir) => {
            const dirPath = path.join(target, dir)
            if (await isDirectory(dirPath)) {
              debug(`Removing directory "${dirPath}"`)
              await fs.rm(dirPath, { recursive: true })
            }
          })
        )
      )
    )
    const dfiles = (
      await glob('**/*.d', {
        cwd: path.join(projectDirectory, 'target'),
        absolute: true,
        onlyFiles: true,
      })
    ).map((file) => slash(file))
    debug(`Removing dep-info files`)
    await Promise.all(
      dfiles.map(async (dfile) => {
        if (await isFile(dfile)) {
          debug(`Removing file "${dfile}"`)
          await fs.rm(dfile)
        }
      })
    )
  } finally {
    endGroup()
  }
}

export const main = async (inputsOverride?: Inputs, install = true) => {
  debug(`Context: ${JSON.stringify(context, null, 0)}`)

  const inputs = inputsOverride ?? getInputs()
  const toolchain = await getToolchain(inputs)

  info(
    `Using toolchain "${toolchain.channel}" with profile "${toolchain.profile}"${
      toolchain.targets.length > 0 ? ` and targets [${toolchain.targets.join(', ')}]` : ''
    }`
  )

  if (install) {
    await installToolchain(toolchain)
  }

  const cargoDirectory = install ? process.env.CARGO_HOME || path.join(os.homedir(), '.cargo') : path.join(os.tmpdir(), 'cargo')
  const cargoBinDirectory = path.join(cargoDirectory, 'bin')
  const projectDirectory = inputs.directory
  const rustVersion = await getRustVersion()

  info(`Using rustc "${rustVersion.version}" with hash "${rustVersion.hash}"`)
  setOutput('rust-version', rustVersion.version)
  setOutput('rust-version-hash', rustVersion.hash)

  debug(`Cargo directory: "${cargoDirectory}"`)
  debug(`Project directory: "${projectDirectory}"`)

  saveState('project-directory', projectDirectory)
  saveState('cargo-directory', cargoDirectory)

  addPath(cargoBinDirectory)

  const binaries = [...inputs.binaries]
  if (inputs.cache) {
    binaries.push('cargo-cache')
    if (inputs.cacheSweep) {
      binaries.push('cargo-sweep')
    }
  }
  if (inputs.sccache) {
    binaries.push('sccache')
  }

  if (binaries.length > 0) {
    if (!(await isFile(path.join(cargoBinDirectory, 'cargo-binstall')))) {
      await installBinstall(cargoBinDirectory)
    }
    if (install) {
      await installBinaries(binaries)
    }
  }

  if (inputs.cache) {
    const cacheKey = await getCacheKey(inputs, projectDirectory, toolchain, rustVersion)

    debug(`Cache key: "${cacheKey.exact}"`)
    saveState('cache-key', cacheKey.exact)

    const cacheHit = install ? await restoreCargoCache(projectDirectory, cargoDirectory, cacheKey) : 'skip'
    if (cacheHit === cacheKey.exact) {
      info(`Cache hit for key "${cacheHit}"`)
      setOutput('cache-hit', 'true')
      saveState('cache-hit', cacheHit)
    } else {
      info(`Cache miss for key "${cacheKey.exact}": "${cacheHit}"`)
    }
  }

  if (inputs.sccache) {
    exportVariable('ACTIONS_CACHE_URL', process.env.ACTIONS_CACHE_URL || '')
    exportVariable('ACTIONS_RUNTIME_TOKEN', process.env.ACTIONS_RUNTIME_TOKEN || '')
    exportVariable('SCCACHE_PATH', slash(path.join(cargoDirectory, 'sccache')))
    exportVariable('SCCACHE_GHA_ENABLED', 'true')
    exportVariable('RUSTC_WRAPPER', 'sccache')
  }

  info(`::add-matcher::${slash(path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'matcher.json'))}`)
}

export const post = async () => {
  const inputs = getInputs()

  if (inputs.sccache) {
    startGroup(`Showing sccache stats`)
    try {
      await spawnCommand('sccache', ['--show-stats'])
    } finally {
      endGroup()
    }
  }

  if (!inputs.cache) {
    return
  }

  const cacheKey = getState('cache-key')
  const cacheHit = getState('cache-hit')
  debug(`Cache key: "${cacheKey}"`)
  debug(`Cache hit: "${cacheHit}"`)

  if (!cacheKey) {
    info(`Cache key not found, not saving cache`)
    return
  }
  if (cacheKey === cacheHit) {
    info(`Cache hit on "${cacheHit}", not saving cache`)
    return
  }

  const projectDirectory = getState('project-directory')
  const cargoDirectory = getState('cargo-directory')
  debug(`Project directory: "${projectDirectory}"`)
  debug(`Cargo directory: "${cargoDirectory}"`)

  if (await isDirectory(cargoDirectory)) {
    await pruneCargoCache(cargoDirectory)
  }
  if (await isDirectory(path.join(projectDirectory, 'target'))) {
    await pruneTargetDirectory(inputs, projectDirectory)
  }

  const cacheId = await saveCargoCache(projectDirectory, cargoDirectory, cacheKey)
  if (cacheId === -1) {
    warning(`Cache could not be saved for key "${cacheKey}"`)
    return
  }
  info(`Cache saved for key "${cacheKey}" with id "${cacheId}"`)
}
