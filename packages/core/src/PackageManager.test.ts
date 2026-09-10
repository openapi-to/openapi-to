import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
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

  test('resolves default and named catalog merges with js-yaml 5', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'package-manager-catalog-'))
    try {
      await writeFile(
        path.join(workspace, 'package.json'),
        JSON.stringify({
          dependencies: {
            zod: 'catalog:',
            lodash: 'catalog:test',
          },
        }),
      )
      await writeFile(
        path.join(workspace, 'pnpm-workspace.yaml'),
        [
          'catalog: &common',
          '  zod: 4.4.3',
          'catalogs:',
          '  test:',
          '    <<: *common',
          '    lodash: 4.17.21',
          '',
        ].join('\n'),
      )

      const manager = new PackageManager(path.join(workspace, 'package.json'))
      expect(await manager.getVersion('zod')).toBe('4.4.3')
      expect(manager.getVersionSync('zod')).toBe('4.4.3')
      expect(await manager.getVersion('lodash')).toBe('4.17.21')
      expect(manager.getVersionSync('lodash')).toBe('4.17.21')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
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
