import { warning } from '@actions/core'
import { getOctokit as getOctokitGitHub } from '@actions/github'
import type { GitHub } from '@actions/github/lib/utils'
import type { OctokitOptions, OctokitPlugin } from '@octokit/core/dist-types/types'

import { retry } from '@octokit/plugin-retry'
import { throttling } from '@octokit/plugin-throttling'
import type { ThrottlingOptions } from '@octokit/plugin-throttling/dist-types/types'

export { context } from '@actions/github'
export { getState, saveState, setFailed, addPath, exportVariable, setOutput } from '@actions/core'

export type { GitHub } from '@actions/github/lib/utils.js'
export type Octokit = InstanceType<typeof GitHub>

export const getOctokit = (token: string, options?: OctokitOptions, ...additionalPlugins: OctokitPlugin[]): Octokit => {
  const throttle: ThrottlingOptions = {
    onRateLimit: (retryAfter: number, options: Record<string, any>) => {
      warning(`Request quota exhausted for request ${options.method as string} ${options.url as string}`)
      if (((options.request as Record<string, any>).retryCount as number) <= 2) {
        console.log(`Retrying after ${retryAfter} seconds!`)
        return true
      }
    },
    onSecondaryRateLimit: (retryAfter: number, options: Record<string, any>, octokit) => {
      octokit.log.warn(`Secondary quota detected for request ${options.method as string} ${options.url as string}`)
    },
  }
  return getOctokitGitHub(
    token,
    {
      throttle,
      ...options,
    },
    retry,
    throttling,
    ...additionalPlugins
  )
}
