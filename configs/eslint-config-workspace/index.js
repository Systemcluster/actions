import { base, jest, node, prettier, turbo, typescript } from '@systemcluster/eslint-config'

/** @type import('eslint').Linter.FlatConfig[] */
export default [base, typescript, node, jest, prettier, turbo]
