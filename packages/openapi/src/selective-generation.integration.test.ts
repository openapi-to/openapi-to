import { access, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  buildFromCompilation,
  buildOperationCatalog,
  projectOpenAPICompilation,
  type CompatibleOpenAPIDocument,
  type OpenAPICompilation,
  type OpenapiToSingleConfig,
  type PluginDefinition,
} from '@openapi-to/core'
import { afterEach, describe, expect, it } from 'vitest'

import { pluginMSW, pluginReactQuery, pluginSWR, pluginTSRequest, pluginTSType, pluginVueQuery, pluginZod } from './index.ts'

function document(): CompatibleOpenAPIDocument {
  return {
    openapi: '3.1.0',
    info: { title: 'Selective plugins', version: '1' },
    paths: {
      '/ping': {
        get: {
          operationId: 'ping',
          tags: ['api'],
          responses: {
            '200': {
              description: 'ok',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/PingResponse' } } },
            },
          },
        },
      },
      '/pong': {
        post: {
          operationId: 'pong',
          tags: ['api'],
          responses: {
            '201': {
              description: 'created',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/PongResponse' } } },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        PingResponse: { type: 'object', properties: { value: { type: 'string' } } },
        PongResponse: { type: 'object', properties: { value: { type: 'boolean' } } },
      },
    },
  } as CompatibleOpenAPIDocument
}

describe('official plugin projected generation', () => {
  const temporaryRoots: string[] = []
  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('keeps operation and schema artifacts selective, deterministic, and byte-equal to full generation', async () => {
    const source = document()
    const compilation: OpenAPICompilation = {
      success: true,
      source: 'fixture',
      uri: 'memory://selective-plugins',
      version: '3.1.0',
      document: source,
      resolvedDocument: source,
      normalizedDocument: source,
      diagnostics: [],
    }
    const catalog = buildOperationCatalog(source, { target: 'main', resolvedDocument: source })
    const projected = projectOpenAPICompilation(compilation, catalog, { type: 'operations', operationKeys: ['ping'] }, { target: 'main', sourceHash: 'fixture-hash' })
    if (!projected.compilation) throw new TypeError('Expected a projected compilation.')

    const variants: Array<{ name: string; plugins: () => PluginDefinition[]; expectedSuffixes: string[] }> = [
      {
        name: 'types-zod-request',
        plugins: () => [pluginTSType(), pluginZod(), pluginTSRequest({ parser: 'zod' })],
        expectedSuffixes: ['.types.ts', '.schema.ts', '.service.ts'],
      },
      {
        name: 'swr',
        plugins: () => [pluginTSType(), pluginTSRequest(), pluginSWR()],
        expectedSuffixes: ['.query.ts'],
      },
      {
        name: 'vue-query',
        plugins: () => [pluginTSType(), pluginTSRequest(), pluginVueQuery()],
        expectedSuffixes: ['.query.ts'],
      },
      {
        name: 'react-query',
        plugins: () => [pluginTSType(), pluginTSRequest(), pluginReactQuery()],
        expectedSuffixes: ['.query.ts'],
      },
      {
        name: 'msw',
        plugins: () => [pluginTSType(), pluginMSW()],
        expectedSuffixes: ['.handler.ts'],
      },
    ]

    for (const variant of variants) {
      const root = await mkdtemp(path.join(os.tmpdir(), `openapi-selective-${variant.name}-`))
      temporaryRoots.push(root)
      const outputRoot = path.join(root, 'generated')
      const config: OpenapiToSingleConfig = {
        name: variant.name,
        root,
        input: { path: 'unused' },
        output: { dir: outputRoot, clean: false },
        plugins: variant.plugins(),
      }
      const full = await buildFromCompilation(config, compilation, { dryRun: true, json: true })
      const selective = await buildFromCompilation(config, projected.compilation, { dryRun: true, json: true })
      const repeated = await buildFromCompilation(config, projected.compilation, { dryRun: true, json: true })
      expect(full.error, `${variant.name} full diagnostics: ${JSON.stringify(full.diagnostics)}`).toBeUndefined()
      expect(selective.error, `${variant.name} selective diagnostics: ${JSON.stringify(selective.diagnostics)}`).toBeUndefined()
      const fullEntries = full.generationResult?.manifest.entries ?? []
      const selectiveEntries = selective.generationResult?.manifest.entries ?? []
      expect(fullEntries.some(({ path: artifactPath }) => artifactPath.includes('pong'))).toBe(true)
      expect(selectiveEntries.some(({ path: artifactPath }) => artifactPath.includes('pong'))).toBe(false)
      expect(selectiveEntries.some(({ path: artifactPath }) => artifactPath.includes('ping-response'))).toBe(true)
      for (const suffix of variant.expectedSuffixes) expect(selectiveEntries.some(({ path: artifactPath }) => artifactPath.endsWith(suffix))).toBe(true)
      const fullHashes = new Map(fullEntries.map((entry) => [entry.path, entry.hash]))
      for (const entry of selectiveEntries) expect(entry.hash).toBe(fullHashes.get(entry.path))
      expect(repeated.generationResult?.manifest.entries).toEqual(selectiveEntries)
      await expect(access(outputRoot)).rejects.toThrow()
    }
  })
})
