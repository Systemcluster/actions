import config from 'jest-config-workspace'

config.setupFiles = ['dotenv/config']
config.setupFilesAfterEnv = ['<rootDir>/jest.setup.js']
config.testTimeout = 60_000
export default config
