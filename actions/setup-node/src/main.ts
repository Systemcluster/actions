import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import url from 'node:url'

import {
  cacheToolDir,
  downloadTool,
  extractTar,
  extractZip,
  findToolCache,
  isCacheAvailable,
  restoreCache,
  saveCache,
} from 'actions-utils/cache'
import { execCommand, spawnCommand } from 'actions-utils/commands'
import { addPath, context, exportVariable, getState, saveState, setOutput } from 'actions-utils/context'
import { isDirectory, isFile } from 'actions-utils/files'
import { getBooleanInput, getStringArrayInput, getStringInput } from 'actions-utils/inputs'
import { debug, endGroup, info, startGroup, warning } from 'actions-utils/outputs'

import nodeVersionAlias, { type SemverVersion } from 'node-version-alias'
import slash from 'slash'
import { glob } from 'tinyglobby'

export interface Inputs {
  nodeVersion: string
  packageManager: string
  directory: string
  install: boolean
  cache: boolean
  cacheKeyJob: boolean
  cacheKeyEnv: string[]
}

export const getInputs = (): Inputs => {
  const inputs = {
    nodeVersion: getStringInput('node-version', false),
    packageManager: getStringInput('package-manager', false),
    directory: getStringInput('directory', false, '.'),
    install: getBooleanInput('install', false),
    cache: getBooleanInput('cache', false, true),
    cacheKeyJob: getBooleanInput('cache-key-job', false),
    cacheKeyEnv: getStringArrayInput('cache-key-env', false),
  }
  inputs.directory = slash(path.join(process.cwd(), inputs.directory))
  return inputs
}

export const getExecutable = (name: string): string => {
  const extension = os.platform() === 'win32' ? '.cmd' : ''
  return name + extension
}

export const parseNodeVersion = (nodeVersion: string): Promise<SemverVersion> => {
  try {
    return nodeVersionAlias(nodeVersion)
  } catch (_error) {
    const error = _error as Error
    throw new Error(`Invalid node version "${nodeVersion}": ${error.message}`)
  }
}

type PackageManager = 'npm' | 'yarn' | 'pnpm'
export interface PackageManagerInfo {
  name: PackageManager
  version: string
}
export const parsePackageManager = (packageManager: string): PackageManagerInfo => {
  const [name, version] = packageManager.split('@')
  if (!name || !['npm', 'yarn', 'pnpm'].includes(name.trim())) {
    throw new Error(`Unknown package manager "${name}"`)
  }
  return {
    name: name.trim() as PackageManager,
    version: version?.trim() || 'latest',
  }
}

export interface PackageJson {
  directory: string
  nodeVersion?: string
  packageManager?: PackageManager
  packageManagerVersion?: string
}
export const findPackageJson = async (directory: string, parents = true): Promise<PackageJson | null> => {
  debug(`Searching for package.json in "${directory}"`)
  if (await isFile(path.join(directory, 'package.json'))) {
    const packagejson = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8')) as {
      packageManager?: string
      engines?: { node?: string }
    }
    const nodeVersion = packagejson.engines?.node
    const packageManager = packagejson.packageManager ? parsePackageManager(packagejson.packageManager) : undefined
    return {
      directory,
      nodeVersion,
      packageManager: packageManager?.name,
      packageManagerVersion: packageManager?.version,
    }
  }
  const parentDirectory = path.dirname(directory)
  if (parents && parentDirectory && parentDirectory !== directory) {
    return findPackageJson(parentDirectory)
  }
  return null
}

export interface LockFile {
  directory: string
  file: string
  packageManager: PackageManager
}
export const findLockFile = async (directory: string, parents = true): Promise<LockFile | null> => {
  debug(`Searching for lockfile in "${directory}"`)
  const lockFiles = [
    ['yarn.lock', 'yarn'],
    ['pnpm-lock.yaml', 'pnpm'],
    ['package-lock.json', 'npm'],
    ['npm-shrinkwrap.json', 'npm'],
  ] as const
  for (const [file, packageManager] of lockFiles) {
    if (await isFile(path.join(directory, file))) {
      return {
        directory,
        file,
        packageManager,
      }
    }
  }
  const parentDirectory = path.dirname(directory)
  if (parents && parentDirectory && parentDirectory !== directory) {
    return findLockFile(parentDirectory)
  }
  return null
}

export interface VersionFile {
  name: string
  directory: string
  version: string
}
export const findVersionFile = async (directory: string, parents = true): Promise<VersionFile | null> => {
  debug(`Searching for version file in "${directory}"`)
  const versionFiles = [
    ['.nvmrc', 'nvm'],
    ['.node-version', 'nodenv'],
  ] as const
  for (const [versionFile, name] of versionFiles) {
    if (await isFile(path.join(directory, versionFile))) {
      return {
        name,
        directory,
        version: (await fs.readFile(path.join(directory, versionFile), 'utf8')).trim(),
      }
    }
  }
  const parentDirectory = path.dirname(directory)
  if (parents && parentDirectory && parentDirectory !== directory) {
    return findVersionFile(parentDirectory)
  }
  return null
}

export interface CacheTarget {
  directories: string[]
  cacheFiles: string[]
}
export const findCacheTarget = async (projectDirectory: string, packageManager: PackageManager): Promise<CacheTarget> => {
  switch (packageManager) {
    case 'npm': {
      const directory = await execCommand(
        getExecutable('npm'),
        ['config', 'get', 'cache'],
        {
          cwd: projectDirectory,
        },
        'Unable to get npm cache directory'
      )
      if (!directory) {
        throw new Error('Unable to get npm cache directory')
      }
      return {
        directories: [directory],
        cacheFiles: ['package-lock.json', 'npm-shrinkwrap.json', 'package.json'],
      }
    }
    case 'pnpm': {
      const directory = await execCommand(
        getExecutable('pnpm'),
        ['store', 'path', '--silent'],
        {
          cwd: projectDirectory,
        },
        'Unable to get pnpm cache directory'
      )
      if (!directory) {
        throw new Error('Unable to get pnpm cache directory')
      }
      return {
        directories: [directory],
        cacheFiles: ['pnpm-lock.yaml', 'package.json'],
      }
    }
    case 'yarn': {
      const version = await execCommand(getExecutable('yarn'), ['--version'], {
        cwd: projectDirectory,
      })
      if (!version) {
        throw new Error(`Unable to get yarn version`)
      }
      const directory = version.startsWith('1.')
        ? await execCommand(
            getExecutable('yarn'),
            ['cache', 'dir'],
            {
              cwd: projectDirectory,
            },
            'Unable to get yarn cache directory'
          )
        : await execCommand(
            getExecutable('yarn'),
            ['config', 'get', 'cacheFolder'],
            {
              cwd: projectDirectory,
            },
            'Unable to get yarn cache directory'
          )
      if (!directory) {
        throw new Error('Unable to get yarn cache directory')
      }
      return {
        directories: [directory],
        cacheFiles: ['yarn.lock', 'package.json'],
      }
    }
  }
}

export const installNode = async (version: SemverVersion): Promise<string> => {
  let arch = os.arch()
  if (arch === 'arm') {
    arch = 'armv7l'
  }
  const platform = os.platform()
  if (process.env.RUNNER_TOOL_CACHE) {
    const cachedNode = findToolCache('node', version, arch)
    if (cachedNode) {
      info(`Node found in tool cache "${cachedNode}"`)
      if (platform !== 'win32') {
        return path.join(cachedNode, 'bin')
      }
      return cachedNode
    }
  }
  let downloadFileName = ''
  switch (platform) {
    case 'win32': {
      downloadFileName = `node-v${version}-win-${arch}.zip`
      break
    }
    case 'darwin': {
      downloadFileName = `node-v${version}-darwin-${arch}.tar.gz`
      break
    }
    case 'linux': {
      downloadFileName = `node-v${version}-linux-${arch}.tar.gz`
      break
    }
    default: {
      throw new Error(`Unknown platform ${platform}`)
    }
  }
  const tempDirectory = process.env.RUNNER_TEMP || path.join(os.tmpdir(), `setup-node-${version}`)
  const downloadPath = path.join(tempDirectory, downloadFileName)
  if (!(await isFile(downloadPath))) {
    debug(`Downloading Node from "https://nodejs.org/dist/v${version}/${downloadFileName}" to "${downloadPath}"`)
    await downloadTool(`https://nodejs.org/dist/v${version}/${downloadFileName}`, downloadPath)
  } else {
    debug(`Node already downloaded to "${downloadPath}"`)
  }
  let nodePath = ''
  if (downloadPath.endsWith('.zip')) {
    await extractZip(downloadPath, tempDirectory)
    nodePath = path.join(tempDirectory, path.basename(downloadPath).replace(/\.zip$/u, ''))
  } else if (downloadPath.endsWith('.tar.gz')) {
    await extractTar(downloadPath, tempDirectory)
    nodePath = path.join(tempDirectory, path.basename(downloadPath).replace(/\.tar\.gz$/u, ''))
  } else {
    throw new Error(`Unknown archive type ${downloadPath}`)
  }
  debug(`Node extracted to ${nodePath}`)
  let cachePath = ''
  if (process.env.RUNNER_TOOL_CACHE) {
    cachePath = await cacheToolDir(nodePath, 'node', version, arch)
    debug(`Node cached in ${cachePath}`)
  } else {
    cachePath = nodePath
  }
  if (platform !== 'win32') {
    cachePath = path.join(cachePath, 'bin')
  }
  return cachePath
}

export const installPackageManager = async (nodePath: string, packageManager: PackageManagerInfo): Promise<string> => {
  startGroup(`Installing ${packageManager.name}@${packageManager.version}`)
  const directory = path.dirname(nodePath)
  try {
    info(`Running "${getExecutable('npm')} install -g ${packageManager.name}@${packageManager.version}" in "${directory}"`)
    await spawnCommand(
      `${path.join(nodePath, getExecutable('npm'))}`,
      ['install', '-g', `${packageManager.name}@${packageManager.version}`, '--loglevel', 'error', '--no-fund'],
      {
        cwd: directory,
      }
    )
  } finally {
    endGroup()
  }
  return path.join(nodePath, getExecutable(packageManager.name))
}

export const installDependencies = async (directory: string, packageManager: PackageManager): Promise<void> => {
  startGroup(`Installing dependencies`)
  info(`Running "${packageManager} install" in "${directory}"`)
  try {
    await spawnCommand(getExecutable(packageManager), ['install'], {
      cwd: directory,
    })
  } finally {
    endGroup()
  }
}

export interface CacheKey {
  exact: string
  partial: string[]
}
export const getCacheKey = async (projectDirectory: string, cacheFiles: string[], inputs: Inputs): Promise<CacheKey> => {
  const hasher = crypto.createHash('sha256')
  for (const cacheFile of cacheFiles) {
    const pattern = `**/${cacheFile}`
    const cachePaths = (
      await glob(pattern, {
        cwd: projectDirectory,
        absolute: true,
        onlyFiles: true,
        ignore: ['**/node_modules/**'],
      })
    ).map((file) => slash(path.relative(projectDirectory, file)))
    for (const cachePath of cachePaths) {
      if (await isFile(cachePath)) {
        if (path.basename(cachePath) === 'package.json') {
          const packageJson = JSON.parse(await fs.readFile(cachePath, 'utf8')) as {
            dependencies?: Record<string, string>
            devDependencies?: Record<string, string>
            peerDependencies?: Record<string, string>
          }
          const dependencies = packageJson.dependencies ?? {}
          const devDependencies = packageJson.devDependencies ?? {}
          const peerDependencies = packageJson.peerDependencies ?? {}
          const dependenciesJson = JSON.stringify({
            dependencies,
            devDependencies,
            peerDependencies,
          })
          hasher.update(dependenciesJson)
          debug(`Hashed dependencies from "${cachePath}"`)
        } else {
          hasher.update(await fs.readFile(cachePath, 'utf8'))
          debug(`Hashed file "${cachePath}"`)
        }
      }
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
    exact: `setup-node-${os.platform()}-${os.arch()}-${hash}`,
    partial: [`setup-node-${os.platform()}-${os.arch()}-`, 'setup-node-'],
  }
}

export const restorePackageManagerCache = async (directories: string[], cacheKey: CacheKey): Promise<string | undefined> => {
  if (!isCacheAvailable()) {
    info('Cache feature is not available on this runner, not restoring cache')
    return
  }
  if (directories.length === 0) {
    info('No directories to cache, not restoring cache')
    return
  }
  const cacheHit = await restoreCache(
    directories.map((directory) => path.normalize(directory)),
    cacheKey.exact,
    cacheKey.partial
  )
  return cacheHit
}

export const savePackageManagerCache = async (directories: string[], cacheKey: string): Promise<number> => {
  if (!isCacheAvailable()) {
    info('Cache feature is not available on this runner, not saving cache')
    return -1
  }
  if (directories.length === 0) {
    info('No directories to cache, not saving cache')
    return -1
  }
  debug(`Caching directories [${directories.join(', ')}]`)
  const cacheId = await saveCache(
    directories.map((directory) => path.normalize(directory)),
    cacheKey
  )
  return cacheId
}

export const prunePackageManagerCache = async (directory: string, packageManager: PackageManager): Promise<void> => {
  if (!isCacheAvailable()) {
    info('Cache feature is not available on this runner, not pruning cache')
    return
  }
  startGroup(`Pruning cache`)
  try {
    switch (packageManager) {
      case 'npm': {
        info(`Running "${packageManager} cache verify"`)
        await spawnCommand(getExecutable(packageManager), ['cache', 'verify'], {
          cwd: directory,
        })
        break
      }
      case 'pnpm': {
        info(`Running "${packageManager} store prune"`)
        await spawnCommand(getExecutable(packageManager), ['store', 'prune'], {
          cwd: directory,
        })
        break
      }
      case 'yarn': {
        info(`Nothing to prune for "${packageManager}"`)
        break
      }
    }
  } finally {
    endGroup()
  }
}

export const main = async (inputsOverride?: Inputs, install = true) => {
  debug(`Context: ${JSON.stringify(context, null, 0)}`)

  const inputs = inputsOverride ?? getInputs()

  const packageJson = await findPackageJson(inputs.directory, false)
  const lockFile = await findLockFile(inputs.directory, true)
  const versionFile = await findVersionFile(inputs.directory, true)

  debug(`package.json: ${JSON.stringify(packageJson, null, 0)}`)
  debug(`lockfile: ${JSON.stringify(lockFile, null, 0)}`)
  debug(`version file: ${JSON.stringify(versionFile, null, 0)}`)

  if (!packageJson && inputs.install) {
    warning(`No package.json found in "${inputs.directory}", unable to install dependencies`)
    inputs.install = false
  }

  let nodeVersion = inputs.nodeVersion
  if (nodeVersion) {
    info(`Using node version from input: "${nodeVersion}"`)
  } else {
    if (packageJson?.nodeVersion && versionFile?.version) {
      info(
        `Node version specified in both package.json and ${versionFile.name}, ` +
          `using version from ${versionFile.name} "${versionFile.version}"`
      )
      nodeVersion = versionFile.version
    } else if (versionFile?.version) {
      info(`Node version specified in ${versionFile.name}, using "${versionFile.version}"`)
      nodeVersion = versionFile.version
    } else if (packageJson?.nodeVersion) {
      info(`Node version specified in package.json, using "${packageJson.nodeVersion}"`)
      nodeVersion = packageJson.nodeVersion
    } else if (packageJson) {
      let currentDirectory = path.dirname(packageJson.directory)
      while (currentDirectory) {
        const packageJson = await findPackageJson(currentDirectory, false)
        if (packageJson?.nodeVersion) {
          info(`Node version specified in package.json, using "${packageJson.nodeVersion}"`)
          nodeVersion = packageJson.nodeVersion
          break
        }
        const parentDirectory = path.dirname(currentDirectory)
        if (parentDirectory !== currentDirectory) {
          currentDirectory = parentDirectory
        } else {
          break
        }
      }
    }
  }
  if (!nodeVersion) {
    info(`No node version specified, using "lts"`)
    nodeVersion = 'lts'
  }
  const parsedNodeVersion = await parseNodeVersion(nodeVersion)

  debug(`Parsed node version: ${parsedNodeVersion}`)
  exportVariable('NODE_VERSION', parsedNodeVersion)
  setOutput('node-version', parsedNodeVersion)

  const nodePath = await installNode(parsedNodeVersion)
  debug(`Node path: ${nodePath}`)
  addPath(nodePath)

  let packageManager = inputs.packageManager ? parsePackageManager(inputs.packageManager) : undefined
  if (packageManager) {
    info(`Using package manager from input: "${packageManager.name}@${packageManager.version}"`)
  } else {
    if (packageJson?.packageManager && lockFile?.packageManager) {
      const name = packageJson.packageManager
      const version = packageJson.packageManagerVersion || 'latest'
      info(
        `Package manager specified in both package.json and lockfile, ` +
          `using package manager from package.json "${name}@${version}"`
      )
      packageManager = {
        name,
        version,
      }
    } else if (packageJson?.packageManager) {
      const name = packageJson.packageManager
      const version = packageJson.packageManagerVersion || 'latest'
      info(`Package manager specified in package.json, using "${name}@${version}"`)
      packageManager = {
        name,
        version,
      }
    } else if (lockFile?.packageManager) {
      const name = lockFile.packageManager
      const version = 'latest'
      info(`Package manager specified in lockfile, using "${name}@${version}"`)
      packageManager = {
        name,
        version,
      }
    } else if (packageJson) {
      let currentDirectory = path.dirname(packageJson.directory)
      while (currentDirectory) {
        const packageJson = await findPackageJson(currentDirectory, false)
        if (packageJson?.packageManager) {
          const name = packageJson.packageManager
          const version = packageJson.packageManagerVersion || 'latest'
          info(`Package manager specified in package.json, using "${name}@${version}"`)
          packageManager = {
            name,
            version,
          }
          break
        }
        const parentDirectory = path.dirname(currentDirectory)
        if (parentDirectory !== currentDirectory) {
          currentDirectory = parentDirectory
        } else {
          break
        }
      }
    }
  }
  if (!packageManager) {
    const name = 'npm'
    const version = 'latest'
    info(`No package manager specified, using "${name}@${version}"`)
    packageManager = {
      name,
      version,
    }
  }
  setOutput('package-manager', packageManager.name)
  saveState('package-manager', packageManager.name)

  const packageManagerPath = await installPackageManager(nodePath, packageManager)
  debug(`Package manager path: ${packageManagerPath}`)

  const projectDirectory = packageJson?.directory || inputs.directory
  debug(`Project directory: ${projectDirectory}`)
  saveState('project-directory', projectDirectory)

  if (inputs.cache) {
    const cacheTarget = await findCacheTarget(projectDirectory, packageManager.name)
    const cacheKey = await getCacheKey(projectDirectory, cacheTarget.cacheFiles, inputs)

    debug(`Cache target: ${JSON.stringify(cacheTarget.directories, null, 0)}`)
    debug(`Cache key: "${JSON.stringify(cacheKey, null, 0)}"`)

    saveState('cache-target', JSON.stringify(cacheTarget.directories))
    saveState('cache-key', cacheKey.exact)

    const cacheHit = install ? await restorePackageManagerCache(cacheTarget.directories, cacheKey) : 'skip'
    if (cacheHit === cacheKey.exact) {
      info(`Cache hit for key "${cacheHit}"`)
      setOutput('cache-hit', 'true')
      saveState('cache-hit', cacheHit)
    } else {
      info(`Cache miss for key "${cacheKey.exact}": "${cacheHit}"`)
    }
  }

  if (install && inputs.install) {
    await installDependencies(projectDirectory, packageManager.name)
  }

  info(`::add-matcher::${slash(path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'matcher.json'))}`)
}

export const post = async () => {
  const inputs = getInputs()
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
  const packageManager = getState('package-manager') as PackageManager
  debug(`Project directory: ${projectDirectory}`)
  debug(`Package manager: ${packageManager}`)

  if (await isDirectory(projectDirectory)) {
    await prunePackageManagerCache(projectDirectory, packageManager)
  }

  const cacheTarget = getState('cache-target') || '[]'
  const cacheDirectories = [] as string[]
  for (const target of JSON.parse(cacheTarget) as string[]) {
    if ((await isFile(target)) || (await isDirectory(target))) {
      cacheDirectories.push(target)
    }
  }
  debug(`Cache target: ${JSON.stringify(cacheDirectories, null, 0)}`)
  if (cacheDirectories.length === 0) {
    info(`Cache target not found, not saving cache`)
    return
  }

  const cacheId = await savePackageManagerCache(cacheDirectories, cacheKey)
  if (cacheId === -1) {
    warning(`Cache could not be saved for key "${cacheKey}"`)
    return
  }
  info(`Cache saved for key "${cacheKey}" with id "${cacheId}"`)
}
