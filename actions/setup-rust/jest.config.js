import config from 'jest-config-workspace'

config.setupFiles = ['dotenv/config']
config.setupFilesAfterEnv = ['<rootDir>/jest.setup.js']
export default config
