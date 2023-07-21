import { main } from './main'

describe('main', () => {
  it('should complete successfully', async () => {
    const promise = main(false)
    await expect(promise).resolves.toBeDefined()
    const result = await promise
    expect(result.results.length).toBeGreaterThan(0)
    expect(result.summary).toMatch(/Released \d+ Actions/u)
  })
})
