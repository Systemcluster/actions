import { setFailed } from 'actions-utils/context'

import { post } from './main.js'

try {
  await post()
} catch (error: any) {
  setFailed(`${(error as { message?: string }).message || (error as string)}`)
}
