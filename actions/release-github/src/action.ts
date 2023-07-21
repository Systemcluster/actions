import { setFailed } from 'actions-utils/context'

import { main } from './main.js'

try {
  await main()
} catch (error: any) {
  setFailed(`${(error as { message?: string }).message || (error as string)}`)
}
