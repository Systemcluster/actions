import { main } from './main'

describe('main', () => {
  it('should complete successfully', async () => {
    await expect(main(undefined, false)).resolves.toBeUndefined()
  })
})
