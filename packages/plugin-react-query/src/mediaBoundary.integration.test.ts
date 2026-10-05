import path from 'node:path'
import { PluginManager, type OpenAPIDocument } from '@openapi-to/core'
import { definePlugin as defineTypePlugin } from '@openapi-to/plugin-ts-type'
import { definePlugin as defineRequestPlugin } from '@openapi-to/plugin-ts-request'
import { describe, expect, it } from 'vitest'
import { definePlugin } from './plugin.ts'

describe('React Query dependency on Request media runtime', () => {
  it('skips querystring hooks when itemSchema prevents Request generation', async () => {
    const document = { openapi: '3.2.1', info: { title: 'querystring', version: '1' }, paths: { '/items': { get: { operationId: 'getItems', tags: ['items'], parameters: [{ name: 'filter', in: 'querystring', content: { 'application/json': { schema: { type: 'object' }, itemSchema: { type: 'string' } } } }], responses: { '204': { description: 'ok' } } } } } } as unknown as OpenAPIDocument
    const result = await new PluginManager({ name: 'wrapper-querystring', root: process.cwd(), input: { path: 'querystring.json' }, output: { dir: path.join(process.cwd(), 'test-output', 'wrapper-querystring') }, plugins: [defineTypePlugin(), defineRequestPlugin(), definePlugin()] }, document).execute()
    expect(result.diagnostics.map((item) => item.code)).toContain('TS_REQUEST_MEDIA_RUNTIME_UNSUPPORTED')
    expect(result.sourceFiles.some((file) => file.getFilePath().endsWith('.service.ts'))).toBe(false)
    expect(result.artifacts.filter((artifact) => artifact.plugin === 'ReactQuery')).toHaveLength(0)
  })
  it('does not emit an artifact when Request rejects OpenAPI 3.2 streaming media', async () => {
    const document = { openapi: '3.2.1', info: { title: 'media', version: '1' }, paths: { '/media': { get: { operationId: 'readMedia', tags: ['media'], responses: { '200': { description: 'ok', content: { 'application/jsonl': { schema: { type: 'array', items: { type: 'string' } } } } } } } } } } as unknown as OpenAPIDocument
    const result = await new PluginManager({ name: 'wrapper-media', root: process.cwd(), input: { path: 'media.json' }, output: { dir: path.join(process.cwd(), 'test-output', 'wrapper-media') }, plugins: [defineTypePlugin(), defineRequestPlugin(), definePlugin()] }, document).execute()
    expect(result.diagnostics.map((item) => item.code)).toContain('TS_REQUEST_MEDIA_RUNTIME_UNSUPPORTED')
    expect(result.sourceFiles.some((file) => file.getFilePath().endsWith('.service.ts'))).toBe(false)
    expect(result.artifacts.filter((artifact) => artifact.plugin === 'ReactQuery')).toHaveLength(0)
  })
})
