import path from 'node:path'
import { PluginManager, type OpenAPIDocument } from '@openapi-to/core'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { definePlugin } from './plugin.ts'

const document = {
  openapi: '3.2.1', info: { title: 'Querystring schemas', version: '1' },
  paths: Object.fromEntries([
    ['form', { schema: { type: 'object', properties: { a: { type: 'string' } } } }],
    ['unknown', {}],
    ['never', { schema: false }],
  ].map(([name, media]) => [`/${name}`, { get: { operationId: `${name}Get`, tags: ['querystring'], parameters: [{ name: 'whole', in: 'querystring', content: { 'application/x-www-form-urlencoded': media } }], responses: { '200': { description: 'ok' } } } }])),
} as unknown as OpenAPIDocument

describe('OpenAPI 3.2 querystring Zod schema truth', () => {
  it('emits independent schemas and preserves empty-object, unknown, and false semantics', async () => {
    const manager = new PluginManager({ name: 'querystring-zod', root: process.cwd(), input: { path: 'querystring.json' }, output: { dir: path.join(process.cwd(), 'test-output', 'querystring-zod') }, plugins: [definePlugin()] }, document)
    const result = await manager.execute()
    const schema = (name: string) => {
      const file = result.sourceFiles.find((item) => item.getFilePath().endsWith(`${name}-get.schema.ts`))
      const initializer = file?.getVariableDeclaration(`${name}GetQuerystringSchema`)?.getInitializer()?.getText()
      if (!initializer) throw new Error(`Missing ${name} querystring schema`)
      return new Function('z', ts.transpile(`return (${initializer});`, { target: ts.ScriptTarget.ES2022 }))(z) as z.ZodType
    }
    expect(schema('form').safeParse({}).success).toBe(true)
    expect(schema('unknown').safeParse({ any: ['value'] }).success).toBe(true)
    expect(schema('never').safeParse('anything').success).toBe(false)
  })
})
