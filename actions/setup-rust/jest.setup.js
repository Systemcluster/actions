process.env['GITHUB_EVENT_NAME'] = 'push'
process.env['GITHUB_SHA'] = 'HEAD'
process.env['GITHUB_REF'] = 'refs/heads/main'
process.env['GITHUB_WORKFLOW'] = 'test'
process.env['GITHUB_ACTION'] = 'test'
process.env['GITHUB_ACTOR'] = 'test'
process.env['GITHUB_JOB'] = 'test'
process.env['GITHUB_RUN_NUMBER'] = '1'
process.env['GITHUB_RUN_ID'] = '1'
process.env['GITHUB_REPOSITORY'] ||= process.env['INPUT_REPOSITORY'] || 'github/.github'

process.env['INPUT_DIRECTORY'] ||= ''
process.env['INPUT_CACHE'] ||= 'true'
