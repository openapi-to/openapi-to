import fs from 'fs-extra'

/*export function getRelativePath(rootDir?: string | null, filePath?: string | null, platform: 'windows' | 'mac' | 'linux' = 'linux'): string {
  if (!rootDir || !filePath) {
    throw new Error(`Root and file should be filled in when retrieving the relativePath, ${rootDir || ''} ${filePath || ''}`)
  }

  const relativePath = relative(rootDir, filePath)

  // On Windows, paths are separated with a "\"
  // However, web browsers use "/" no matter the platform
  const slashedPath = slash(relativePath, platform)

  if (slashedPath.startsWith('../')) {
    return slashedPath.replace(basename(slashedPath), basename(slashedPath, extname(filePath)))
  }

  return `./${slashedPath.replace(basename(slashedPath), basename(slashedPath, extname(filePath)))}`
}*/

export async function read(path: string): Promise<string> {
  return fs.readFile(path, { encoding: 'utf8' })
}

export function readSync(path: string): string {
  return fs.readFileSync(path, { encoding: 'utf8' })
}
