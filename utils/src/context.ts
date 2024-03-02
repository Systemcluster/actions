import { warning } from '@actions/core'
import { getOctokit as getOctokitGitHub } from '@actions/github'

import { Octokit, OctokitOptions } from '@octokit/core'
import { PaginateInterface } from '@octokit/plugin-paginate-rest'
import { restEndpointMethods } from '@octokit/plugin-rest-endpoint-methods'
import { retry } from '@octokit/plugin-retry'
import { ThrottlingOptions, throttling } from '@octokit/plugin-throttling'

export { addPath, exportVariable, getState, saveState, setFailed, setOutput } from '@actions/core'
export { context } from '@actions/github'

export type Constructor<T> = new (...args: any[]) => T
export type GitHub = typeof Octokit & Constructor<ReturnType<typeof restEndpointMethods> & { paginate: PaginateInterface }>
export type OctokitPlugin = Parameters<typeof getOctokitGitHub>[2]

export const getOctokit = (token: string, options?: OctokitOptions, ...additionalPlugins: OctokitPlugin[]): InstanceType<GitHub> => {
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
