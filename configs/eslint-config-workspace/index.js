import { base, jest, node, prettier, turbo, typescript } from '@systemcluster/eslint-config'

/** @type import('eslint').Linter.Config[] */
export default [base, typescript, node, jest, prettier, turbo]
