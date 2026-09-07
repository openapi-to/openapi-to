import path from 'node:path'

import { PackageManager } from './PackageManager.ts'

describe('getPackageJSON', () => {
  const packageManager = new PackageManager(path.resolve(__dirname, './package.json'))

  test('if package.json data is returned', async () => {
    const packageJSON = await packageManager.getPackageJSON()

    expect(packageJSON).toBeDefined()
  })

  test('if compared version is correct', async () => {
    expect(await packageManager.getVersion('axios')).toBe('1.19.0')
    expect(packageManager.getVersionSync('axios')).toBe('1.19.0')
    expect(await packageManager.isValid('axios', '^1.6.5')).toBeTruthy()
    expect(packageManager.isValidSync('axios', '^1.6.5')).toBeTruthy()
  })

  test('resolves a named catalog version', async () => {
    const namedCatalogManager = new PackageManager(
      path.resolve(__dirname, '../../mcp/package.json'),
    )

    expect(await namedCatalogManager.getVersion('zod')).toBe('4.4.3')
    expect(namedCatalogManager.getVersionSync('zod')).toBe('4.4.3')
  })

  test('normalizeDirectory', () => {
    expect(packageManager.normalizeDirectory('/user/nzakas/foo')).toBe('/user/nzakas/foo/')
    expect(packageManager.normalizeDirectory('/user/nzakas/foo/')).toBe('/user/nzakas/foo/')
  })
  test('it should find mocks/noop.js file with default cwd and ESM', async () => {
    packageManager.workspace = __dirname

    const module = await packageManager.import(path.join(__dirname, '../mock/noop.js'))

    const fn = module?.noop ? module.noop : module

    expect(fn?.()).toBe('js-noop')
  })

  test('it should find mocks/noop.js file with default cwd and CJS', async () => {
    packageManager.workspace = __dirname

    const module = await packageManager.import(path.join(__dirname, '../mock/noop.cjs'))

    const fn = module?.noop ? module.noop : module

    expect(fn?.()).toBe('cjs-noop')
  })

  test('if overriding cache with static setVersion works', async () => {
    PackageManager.setVersion('typescript', '^4.1.1')
    expect(await packageManager.isValid('typescript', '>=5')).toBeFalsy()

    PackageManager.setVersion('typescript', '^5.1.1')
    expect(await packageManager.isValid('typescript', '>=5')).toBeTruthy()
  })
})
