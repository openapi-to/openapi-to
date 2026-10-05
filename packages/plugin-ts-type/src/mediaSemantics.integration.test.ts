import path from 'node:path'
import { PluginManager, type OpenAPIDocument } from '@openapi-to/core'
import { describe, expect, it } from 'vitest'
import { definePlugin } from './plugin.ts'

function document(media: object, mediaType = 'application/jsonl') {
  return { openapi: '3.2.1', info: { title: 'media', version: '1' }, paths: { '/send': { post: { operationId: 'send', tags: ['media'], requestBody: { content: { [mediaType]: media } }, responses: { '200': { description: 'ok', content: { [mediaType]: media } } } } } }, components: { requestBodies: { Shared: { content: { [mediaType]: media } } }, responses: { Shared: { description: 'ok', content: { [mediaType]: media } } } } } as unknown as OpenAPIDocument
}
async function generate(doc: OpenAPIDocument) {
  return new PluginManager({ name: 'type-media', root: process.cwd(), input: { path: 'media.json' }, output: { dir: path.join(process.cwd(), 'test-output', 'type-media') }, plugins: [definePlugin()] }, doc).execute()
}

describe('OpenAPI 3.2 Type media semantics', () => {
  it('fails closed for querystring itemSchema while retaining schema-only querystring types', async () => {
    const make = (media: object) => ({ openapi: '3.2.1', info: { title: 'querystring', version: '1' }, paths: { '/items': { get: { operationId: 'getItems', tags: ['items'], parameters: [{ name: 'filter', in: 'querystring', content: { 'application/json': media } }], responses: { '204': { description: 'ok' } } } } } }) as unknown as OpenAPIDocument
    for (const media of [{ itemSchema: { type: 'string' } }, { schema: { type: 'object' }, itemSchema: { type: 'string' } }]) {
      const result = await generate(make(media))
      expect(result.diagnostics.map((item) => item.code)).toContain('TS_TYPE_ITEM_STREAM_UNSUPPORTED')
      expect(result.sourceFiles.map((file) => file.getFullText()).join('\n')).toContain('GetItemsQuerystring = never')
    }
    const schemaOnly = await generate(make({ schema: { type: 'object', properties: { q: { type: 'string' } } } }))
    expect(schemaOnly.diagnostics.map((item) => item.code)).not.toContain('TS_TYPE_ITEM_STREAM_UNSUPPORTED')
    expect(schemaOnly.sourceFiles.map((file) => file.getFullText()).join('\n')).not.toContain('GetItemsQuerystring = never')
  })
  it('resolves schema-only querystring Media Type references', async () => {
    const doc = { openapi: '3.2.1', info: { title: 'querystring', version: '1' }, paths: { '/items': { get: { operationId: 'getItems', tags: ['items'], parameters: [{ name: 'filter', in: 'querystring', content: { 'application/json': { $ref: '#/components/mediaTypes/Filter' } } }], responses: { '204': { description: 'ok' } } } } }, components: { mediaTypes: { Filter: { schema: { type: 'object', properties: { q: { type: 'string' } } } } } } } as unknown as OpenAPIDocument
    const result = await generate(doc)
    const text = result.sourceFiles.map((file) => file.getFullText()).join('\n')
    expect(text).toContain('q?: string')
    expect(text).not.toContain('MediaTypesFilter')
  })
  it('does not import a querystring schema discarded by itemSchema fail closed', async () => {
    const doc = { openapi: '3.2.1', info: { title: 'querystring', version: '1' }, paths: { '/items': { get: { operationId: 'getItems', tags: ['items'], parameters: [{ name: 'filter', in: 'querystring', content: { 'application/json': { schema: { $ref: '#/components/schemas/Filter' }, itemSchema: { type: 'string' } } } }], responses: { '204': { description: 'ok' } } } } }, components: { schemas: { Filter: { type: 'string' } } } } as unknown as OpenAPIDocument
    const result = await generate(doc)
    const operation = result.sourceFiles.find((file) => file.getFilePath().includes('get-items'))?.getFullText() ?? ''
    expect(operation).toContain('GetItemsQuerystring = never')
    expect(operation).not.toContain('FilterModel')
  })
  it('keeps schema-only sequential complete-content types', async () => {
    const result = await generate(document({ schema: { type: 'array', items: { type: 'string' } } }))
    expect(result.diagnostics.map((item) => item.code)).not.toContain('TS_TYPE_ITEM_STREAM_UNSUPPORTED')
    const text = result.sourceFiles.map((file) => file.getFullText()).join('\n')
    expect(text).toContain('Array<string>')
    expect(text).not.toContain(' = never')
  })
  it('fails closed for itemSchema alone and together with schema across operation and components', async () => {
    for (const media of [{ itemSchema: { type: 'string' } }, { schema: { type: 'array', items: { type: 'number' } }, itemSchema: { type: 'number' } }]) {
      const result = await generate(document(media))
      expect(result.diagnostics.filter((item) => item.code === 'TS_TYPE_ITEM_STREAM_UNSUPPORTED')).toHaveLength(4)
      const text = result.sourceFiles.map((file) => file.getFullText()).join('\n')
      expect(text).toContain('RequestBodiesSharedModel = never')
      expect(text).toContain('ResponseShared = never')
      expect(text).toContain('SendMutationRequest = never')
      expect(text).toContain('SendMutationResponse200 = never')
    }
  })
  it('resolves reusable media and preserves schema-only positional data types', async () => {
    const doc = document({ $ref: '#/components/mediaTypes/Parts' }, 'multipart/mixed') as unknown as Record<string, unknown>
    ;(doc.components as Record<string, unknown>).mediaTypes = { Parts: { schema: { type: 'array', items: { type: 'string' } }, prefixEncoding: [{}] } }
    const result = await generate(doc as OpenAPIDocument)
    expect(result.diagnostics.map((item) => item.code)).not.toContain('TS_TYPE_ITEM_STREAM_UNSUPPORTED')
    expect(result.sourceFiles.map((file) => file.getFullText()).join('\n')).toContain('Array<string>')
  })
  it('collects enums and schema refs from reusable media without dangling imports', async () => {
    const doc = document({ $ref: '#/components/mediaTypes/EnumMedia' }, 'application/json-seq') as unknown as Record<string, unknown>
    ;(doc.components as Record<string, unknown>).mediaTypes = { EnumMedia: { schema: { type: 'object', properties: { status: { type: 'string', enum: ['on', 'off'] }, item: { $ref: '#/components/schemas/Item' } } } } }
    ;(doc.components as Record<string, unknown>).schemas = { Item: { type: 'string' } }
    const result = await generate(doc as OpenAPIDocument)
    expect(result.diagnostics).toEqual([])
    const text = result.sourceFiles.map((file) => file.getFullText()).join('\n')
    expect(text).toContain('ItemModel')
    expect(text).toContain('status')
  })

})
