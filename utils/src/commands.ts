import child_process, { type ExecFileOptions, type SpawnSyncOptions } from 'node:child_process'
import util from 'node:util'

export type { ExecFileOptions, SpawnSyncOptions } from 'node:child_process'

export const execCommand = async (
  command: string,
  args: string[] = [],
  options: ExecFileOptions & { encoding?: never } = {},
  errorMessage?: string
): Promise<string> => {
  try {
    const result = await util.promisify(child_process.execFile)(command, args, {
      encoding: 'utf8',
      timeout: 180_000,
      maxBuffer: 30_000_000,
      shell: true,
      ...options,
    })
    return result.stdout.trim()
  } catch (_error) {
    const error = _error as { stdout: string; stderr: string; code: number }
    const message =
      (errorMessage ? `${errorMessage}: ` : `Error running ${command}: `) +
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      (error.stderr?.trim() || error.stdout?.trim() || `Returned ${error.code}`)
    throw new Error(message)
  }
}
export const spawnCommand = (
  command: string,
  args: string[] = [],
  options: SpawnSyncOptions & { encoding?: never; stdio?: never } = {}
): Promise<number> => {
  const result = child_process.spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'inherit', 'inherit'],
    timeout: 360_000,
    maxBuffer: 120_000_000,
    shell: true,
    ...options,
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`${command} returned with exit code ${result.status}`)
  }
  return Promise.resolve(result.status)
}
