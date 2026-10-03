import path from 'node:path'
import { PluginManager, type OpenAPIDocument } from '@openapi-to/core'
import { describe, expect, it } from 'vitest'
import { definePlugin } from './plugin.ts'

const parameter = (media: Record<string, unknown>, required = false) => ({ name: 'whole', in: 'querystring', required, content: { 'application/json': media } })

describe('OpenAPI 3.2 querystring types', () => {
  it('uses content schema for required, optional, referenced, unknown, and false forms', async () => {
    const document = {
      openapi: '3.2.1', info: { title: 'Querystring types', version: '1' },
      components: { parameters: { Whole: parameter({ schema: { $ref: '#/components/schemas/Filter' } }, true) }, schemas: { Filter: { type: 'object', properties: { q: { type: 'string' } } } } },
      paths: {
        '/inherited': { parameters: [{ $ref: '#/components/parameters/Whole' }], get: { operationId: 'inheritedGet', tags: ['whole'], responses: { '200': { description: 'ok' } } } },
        '/unknown': { query: { operationId: 'unknownQuery', tags: ['whole'], parameters: [parameter({})], responses: { '200': { description: 'ok' } } } },
        '/never': { post: { operationId: 'neverPost', tags: ['whole'], parameters: [parameter({ schema: false })], responses: { '200': { description: 'ok' } } } },
      },
    } as unknown as OpenAPIDocument
    const result = await new PluginManager({ name: 'querystring-types', root: process.cwd(), input: { path: 'querystring.json' }, output: { dir: path.join(process.cwd(), 'test-output', 'querystring-types') }, plugins: [definePlugin()] }, document).execute()
    const text = (name: string) => result.sourceFiles.find((file) => file.getFilePath().endsWith(`${name}.types.ts`))?.getFullText() ?? ''
    expect(text('inherited-get')).toContain('InheritedGetQuerystring')
    expect(text('inherited-get')).toContain('querystring: InheritedGetQuerystring')
    expect(text('unknown-query')).toContain('type UnknownQueryQuerystring = unknown')
    expect(text('unknown-query')).toContain('querystring?: UnknownQueryQuerystring | undefined')
    expect(text('never-post')).toContain('type NeverPostQuerystring = never')
  })
})
