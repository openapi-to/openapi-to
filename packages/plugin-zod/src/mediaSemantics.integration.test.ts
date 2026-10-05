import path from 'node:path'
import { PluginManager, type OpenAPIDocument } from '@openapi-to/core'
import { describe, expect, it } from 'vitest'
import { definePlugin } from './plugin.ts'

function document(media: object, mediaType = 'application/json-seq') {
  return { openapi: '3.2.1', info: { title: 'media', version: '1' }, paths: { '/send': { post: { operationId: 'send', tags: ['media'], requestBody: { content: { [mediaType]: media } }, responses: { '200': { description: 'ok', content: { [mediaType]: media } } } } } }, components: { requestBodies: { Shared: { content: { [mediaType]: media } } }, responses: { Shared: { description: 'ok', content: { [mediaType]: media } } } } } as unknown as OpenAPIDocument
}
async function generate(doc: OpenAPIDocument) {
  return new PluginManager({ name: 'zod-media', root: process.cwd(), input: { path: 'media.json' }, output: { dir: path.join(process.cwd(), 'test-output', 'zod-media') }, plugins: [definePlugin()] }, doc).execute()
}

describe('OpenAPI 3.2 Zod media semantics', () => {
  it('fails closed for querystring itemSchema while retaining schema-only validation', async () => {
    const make = (media: object) => ({ openapi: '3.2.1', info: { title: 'querystring', version: '1' }, paths: { '/items': { get: { operationId: 'getItems', tags: ['items'], parameters: [{ name: 'filter', in: 'querystring', content: { 'application/json': media } }], responses: { '204': { description: 'ok' } } } } } }) as unknown as OpenAPIDocument
    for (const media of [{ itemSchema: { type: 'string' } }, { schema: { type: 'object' }, itemSchema: { type: 'string' } }]) {
      const result = await generate(make(media))
      expect(result.diagnostics.map((item) => item.code)).toContain('ZOD_ITEM_STREAM_UNSUPPORTED')
      expect(result.sourceFiles.map((file) => file.getFullText()).join('\n')).toContain('getItemsQuerystringSchema = z.never()')
    }
    const schemaOnly = await generate(make({ schema: { type: 'object', properties: { q: { type: 'string' } } } }))
    expect(schemaOnly.diagnostics.map((item) => item.code)).not.toContain('ZOD_ITEM_STREAM_UNSUPPORTED')
    expect(schemaOnly.sourceFiles.map((file) => file.getFullText()).join('\n')).not.toContain('getItemsQuerystringSchema = z.never()')
  })
  it('resolves schema-only querystring Media Type references', async () => {
    const doc = { openapi: '3.2.1', info: { title: 'querystring', version: '1' }, paths: { '/items': { get: { operationId: 'getItems', tags: ['items'], parameters: [{ name: 'filter', in: 'querystring', content: { 'application/json': { $ref: '#/components/mediaTypes/Filter' } } }], responses: { '204': { description: 'ok' } } } } }, components: { mediaTypes: { Filter: { schema: { type: 'object', properties: { q: { type: 'string' } } } } } } } as unknown as OpenAPIDocument
    const result = await generate(doc)
    const text = result.sourceFiles.map((file) => file.getFullText()).join('\n')
    expect(text).toContain('z.looseObject({"q": z.string().optional()})')
    expect(text).not.toContain('MediaTypesFilter')
  })
  it('does not import a querystring schema discarded by itemSchema fail closed', async () => {
    const doc = { openapi: '3.2.1', info: { title: 'querystring', version: '1' }, paths: { '/items': { get: { operationId: 'getItems', tags: ['items'], parameters: [{ name: 'filter', in: 'querystring', content: { 'application/json': { schema: { $ref: '#/components/schemas/Filter' }, itemSchema: { type: 'string' } } } }], responses: { '204': { description: 'ok' } } } } }, components: { schemas: { Filter: { type: 'string' } } } } as unknown as OpenAPIDocument
    const result = await generate(doc)
    const operation = result.sourceFiles.find((file) => file.getFilePath().includes('get-items'))?.getFullText() ?? ''
    expect(operation).toContain('getItemsQuerystringSchema = z.never()')
    expect(operation).not.toContain('filterSchema')
  })
  it('validates schema-only sequential complete-content arrays', async () => {
    const result = await generate(document({ schema: { type: 'array', items: { type: 'string' } } }))
    expect(result.diagnostics.map((item) => item.code)).not.toContain('ZOD_ITEM_STREAM_UNSUPPORTED')
    expect(result.sourceFiles.map((file) => file.getFullText()).join('\n')).toContain('z.array(z.string())')
  })
  it('uses z.never and an error for itemSchema across operation and components', async () => {
    for (const media of [{ itemSchema: { type: 'string' } }, { schema: { type: 'array', items: { type: 'string' } }, itemSchema: { type: 'string' } }]) {
      const result = await generate(document(media))
      expect(result.diagnostics.filter((item) => item.code === 'ZOD_ITEM_STREAM_UNSUPPORTED')).toHaveLength(4)
      const text = result.sourceFiles.map((file) => file.getFullText()).join('\n')
      expect((text.match(/z\.never\(\)/g) ?? []).length).toBeGreaterThanOrEqual(4)
    }
  })
  it('keeps positional-only schema validation and resolves reusable media', async () => {
    const doc = document({ $ref: '#/components/mediaTypes/Parts' }, 'multipart/related') as unknown as Record<string, unknown>
    ;(doc.components as Record<string, unknown>).mediaTypes = { Parts: { schema: { type: 'array', items: { type: 'string' } }, itemEncoding: {} } }
    const result = await generate(doc as OpenAPIDocument)
    expect(result.diagnostics.map((item) => item.code)).not.toContain('ZOD_ITEM_STREAM_UNSUPPORTED')
    expect(result.sourceFiles.map((file) => file.getFullText()).join('\n')).toContain('z.array(z.string())')
  })
  it('keeps schema references from reusable media in generated imports', async () => {
    const doc = document({ $ref: '#/components/mediaTypes/Shared' }) as unknown as Record<string, unknown>
    ;(doc.components as Record<string, unknown>).mediaTypes = { Shared: { schema: { $ref: '#/components/schemas/Entry' } } }
    ;(doc.components as Record<string, unknown>).schemas = { Entry: { type: 'string' } }
    const result = await generate(doc as OpenAPIDocument)
    expect(result.diagnostics.map((item) => item.code)).not.toContain('PLUGIN_EXECUTION_FAILED')
    const text = result.sourceFiles.map((file) => file.getFullText()).join('\n')
    expect(text).toContain('entrySchema')
    expect(text).not.toContain('z.unknown()')
  })

})
