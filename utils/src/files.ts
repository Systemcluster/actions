import fs from 'node:fs/promises'

export const isFile = async (path: string): Promise<boolean> => {
  try {
    return (await fs.stat(path)).isFile()
  } catch {
    return false
  }
}
export const isDirectory = async (path: string): Promise<boolean> => {
  try {
    return (await fs.stat(path)).isDirectory()
  } catch {
    return false
  }
}
