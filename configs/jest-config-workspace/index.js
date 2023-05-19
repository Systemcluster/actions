/** @type import('jest').Config */
export default {
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'ts'],
  extensionsToTreatAsEsm: ['.ts'],
  testRegex: '.*\\.test\\.(t|j)s$',
  transform: {
    '^.+\\.m?(t|j)s$': [
      '@swc/jest',
      {
        jsc: {
          parser: {
            syntax: 'typescript',
            dynamicImport: false,
            decorators: true,
          },
          target: 'es2021',
          loose: false,
        },
      },
    ],
  },
  transformIgnorePatterns: [],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  clearMocks: true,
  testTimeout: 30_000,
  reporters: [process.env.GITHUB_ACTION ? ['github-actions', { silent: false }] : 'default', 'summary'],
}
