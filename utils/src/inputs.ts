import { getInput, getMultilineInput } from '@actions/core'

export const getStringInput = (name: string, required: boolean = true, fallback: string = ''): string => {
  const value = getInput(name, { required: false })
  if (value === '' && required) {
    throw new TypeError(`Input "${name}" is required and was not supplied`)
  }
  return value || fallback
}
export const getBooleanInput = (name: string, required: boolean = true, fallback: boolean = false): boolean => {
  const value = getInput(name, { required: false }).toLowerCase()
  if (value === '') {
    if (required) {
      throw new TypeError(`Input "${name}" is required and was not supplied`)
    }
    return fallback
  }
  if (['true', 'yes', 'on', '1'].includes(value)) {
    return true
  }
  if (['false', 'no', 'off', '0'].includes(value)) {
    return false
  }
  throw new TypeError(`Input "${name}" is not a boolean: "${value}"`)
}
export const getNumberInput = (name: string, required: boolean = true, fallback: number = 0): number => {
  const value = getInput(name, { required: false })
  if (value === '' && required) {
    throw new TypeError(`Input required and not supplied: "${name}"`)
  }
  const number = Number(value)
  if (Number.isNaN(number)) {
    throw new TypeError(`Input "${name}" is not a number: "${value}"`)
  }
  return number || fallback
}
export const getStringArrayInput = (name: string, required: boolean = true): string[] => {
  const value = getMultilineInput(name, { required: false })
    .map((s) => s.trim())
    .filter(Boolean)
  if (value.length === 0 && required) {
    throw new TypeError(`Input "${name}" is required and was not supplied`)
  }
  return value
}
