import path from 'node:path'
import { createServer } from 'node:http'
import { PluginManager, type OpenAPIDocument } from '@openapi-to/core'
import { definePlugin as defineTypePlugin } from '@openapi-to/plugin-ts-type'
import axios from 'axios'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { definePlugin as defineRequestPlugin } from './plugin.ts'

const document = {
  openapi: '3.2.1', info: { title: 'querystring', version: '1' },
  paths: {
    '/form': { get: { operationId: 'formGet', tags: ['querystring'], parameters: [{ name: 'filter', in: 'querystring', required: true, content: { 'application/x-www-form-urlencoded': { schema: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'array', items: { type: 'string' } } } } } } }], responses: { '200': { description: 'ok' } } } },
    '/json': { query: { operationId: 'jsonQuery', tags: ['querystring'], parameters: [{ name: 'json', in: 'querystring', content: { 'application/json': { schema: { type: 'object' } } } }], responses: { '200': { description: 'ok' } } } },
  },
} as unknown as OpenAPIDocument

async function generated(requestClient: 'axios' | 'common' | 'fetch' = 'axios') {
  const manager = new PluginManager({ name: 'querystring-runtime', root: process.cwd(), input: { path: 'querystring.json' }, output: { dir: path.join(process.cwd(), 'test-output', 'querystring-runtime') }, plugins: [defineTypePlugin(), defineRequestPlugin({ requestClient })] }, document)
  return manager.execute()
}

function service(result: Awaited<ReturnType<typeof generated>>, fileName: string, functionName: string, request: (config: Record<string, unknown>) => Promise<unknown>) {
  const file = result.sourceFiles.find((item) => item.getFilePath().endsWith(fileName))
  const source = file?.getFunction(functionName)?.getText()
  if (!source) throw new Error(`Missing generated service ${functionName}`)
  return executable(source, functionName, request)
}

function executable(source: string, name: string, request: (config: Record<string, unknown>) => Promise<unknown>) {
  const transpiled = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext })
  return new Function('request', `${transpiled.replace(/^export /gm, '')}\nreturn ${name};`)(request) as (input: unknown, requestConfig?: Record<string, unknown>) => Promise<unknown>
}

describe('OpenAPI 3.2 whole-querystring request transport', () => {
	it('keeps supported querystring serialization owned by Request in Fetch mode', async () => {
		const result = await generated('fetch')
		const source = result.sourceFiles.find((file) => file.getFilePath().endsWith('json-query.service.ts'))?.getFullText() ?? ''
		expect(result.diagnostics.some(({ code }) => code === 'TS_REQUEST_QUERYSTRING_UNSUPPORTED')).toBe(false)
		expect(source).toContain('"QUERY"')
		expect(source).toContain('querystringJson')
		expect(source).toContain('Unable to serialize OpenAPI querystring.')
		await Promise.all(result.sourceFiles.map((file) => file.save()))
		const program = ts.createProgram(result.sourceFiles.map((file) => file.getFilePath()), {
			allowImportingTsExtensions: true,
			lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
			module: ts.ModuleKind.ESNext,
			moduleResolution: ts.ModuleResolutionKind.Bundler,
			noEmit: true,
			strict: true,
			target: ts.ScriptTarget.ES2022,
			types: [],
		})
		expect(ts.getPreEmitDiagnostics(program).map(({ messageText }) => ts.flattenDiagnosticMessageText(messageText, "\n"))).toEqual([])
	})

	it('passes the same completed URL to the common request client', async () => {
		const result = await generated('common')
		const calls: Record<string, unknown>[] = []
		const form = service(result, 'form-get.service.ts', 'formGetService', async (config) => { calls.push(config); return { data: 'ok' } })
		await form({ querystring: { a: 'a b' } })
		expect(calls[0]).toEqual(expect.objectContaining({ url: '/form?a=a+b' }))
		await expect(form({ querystring: {} })).rejects.toThrow('no pairs')
		expect(calls).toHaveLength(1)
	})
	it('delivers the complete form and JSON URL through Axios Node', async () => {
		const result = await generated()
		const seen: string[] = []
		const server = createServer((req, res) => { seen.push(req.url ?? ''); res.setHeader('content-type', 'application/json'); res.end('{}') })
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
		try {
			const address = server.address()
			if (!address || typeof address === 'string') throw new Error('Missing local server address')
			const client = axios.create({ baseURL: `http://127.0.0.1:${address.port}`, proxy: false })
			const form = service(result, 'form-get.service.ts', 'formGetService', client.request.bind(client))
			const json = service(result, 'json-query.service.ts', 'jsonQueryService', client.request.bind(client))
			await form({ querystring: { b: ['x', 'y'], a: ' +' } })
			await json({ querystring: { q: ' +' } })
			expect(seen).toEqual(['/form?a=+%2B&b=x&b=y', '/json?%7B%22q%22%3A%22%20%2B%22%7D'])
			await expect(form({ querystring: {} })).rejects.toThrow('no pairs')
			expect(seen).toHaveLength(2)
		} finally {
			await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
		}
	})
	it('reports legal but unsupported media and form shapes without emitting request methods', async () => {
		const unsupported = {
			openapi: '3.2.1', info: { title: 'unsupported', version: '1' }, paths: {
			'/plain': { get: { operationId: 'plainGet', tags: ['querystring'], parameters: [{ name: 'whole', in: 'querystring', content: { 'text/plain': { schema: { type: 'string' } } } }], responses: { '200': { description: 'ok' } } } },
			'/nested': { get: { operationId: 'nestedGet', tags: ['querystring'], parameters: [{ name: 'whole', in: 'querystring', content: { 'application/x-www-form-urlencoded': { schema: { type: 'object', properties: { nested: { type: 'object' } } } } } }], responses: { '200': { description: 'ok' } } } },
			'/encoded': { get: { operationId: 'encodedGet', tags: ['querystring'], parameters: [{ name: 'whole', in: 'querystring', content: { 'application/x-www-form-urlencoded': { schema: { type: 'object' }, encoding: { a: { contentType: 'text/plain' } } } } }], responses: { '200': { description: 'ok' } } } },
			'/additional-object': { get: { operationId: 'additionalObjectGet', tags: ['querystring'], parameters: [{ name: 'whole', in: 'querystring', content: { 'application/x-www-form-urlencoded': { schema: { type: 'object', required: ['a'], additionalProperties: { type: 'object' } } } } }], responses: { '200': { description: 'ok' } } } },
			'/additional-true': { get: { operationId: 'additionalTrueGet', tags: ['querystring'], parameters: [{ name: 'whole', in: 'querystring', content: { 'application/x-www-form-urlencoded': { schema: { type: 'object', additionalProperties: true } } } }], responses: { '200': { description: 'ok' } } } },
			'/zero-only': { get: { operationId: 'zeroOnlyGet', tags: ['querystring'], parameters: [{ name: 'whole', in: 'querystring', content: { 'application/x-www-form-urlencoded': { schema: { type: 'object', additionalProperties: false } } } }], responses: { '200': { description: 'ok' } } } },
		} } as unknown as OpenAPIDocument
		const result = await new PluginManager({ name: 'querystring-unsupported', root: process.cwd(), input: { path: 'querystring.json' }, output: { dir: path.join(process.cwd(), 'test-output', 'querystring-unsupported') }, plugins: [defineTypePlugin(), defineRequestPlugin()] }, unsupported).execute()
		expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'TS_REQUEST_QUERYSTRING_UNSUPPORTED')).toHaveLength(6)
		expect(result.sourceFiles.some((file) => /(?:plain|nested|encoded|additional-object|additional-true|zero-only)-get\.service\.ts$/.test(file.getFilePath()))).toBe(false)
	})
  it('serializes form and JSON into the generated URL and fails before dispatch', async () => {
    const result = await generated()
    const configs: Record<string, unknown>[] = []
    const request = async (config: Record<string, unknown>) => { configs.push(config); return { data: 'ok' } }
    const formFile = result.sourceFiles.find((file) => file.getFilePath().endsWith('form-get.service.ts'))
    const jsonFile = result.sourceFiles.find((file) => file.getFilePath().endsWith('json-query.service.ts'))
    const formType = result.sourceFiles.find((file) => file.getFilePath().endsWith('form-get.types.ts'))?.getFullText() ?? ''
    const jsonType = result.sourceFiles.find((file) => file.getFilePath().endsWith('json-query.types.ts'))?.getFullText() ?? ''
    expect(formType).toContain('FormGetQuerystring')
    expect(formType).toContain('querystring: FormGetQuerystring')
    expect(jsonType).toContain('querystring?: JsonQueryQuerystring | undefined')
    expect(formFile).toBeDefined()
    expect(jsonFile).toBeDefined()
    const form = service(result, 'form-get.service.ts', 'formGetService', request)
    const json = service(result, 'json-query.service.ts', 'jsonQueryService', request)
    await form({ querystring: { b: ['1', '2'], a: ' +&=中' } })
    expect(configs[0]).toEqual(expect.objectContaining({ url: '/form?a=+%2B%26%3D%E4%B8%AD&b=1&b=2' }))
    expect(configs[0]).not.toHaveProperty('params')
    await json({ querystring: { b: 0, a: "!'()*" } })
    expect(configs[1]).toEqual(expect.objectContaining({ url: '/json?%7B%22a%22%3A%22%21%27%28%29%2A%22%2C%22b%22%3A0%7D' }))
    await json({})
    expect(configs[2]).toEqual(expect.objectContaining({ url: '/json' }))
    for (const value of [null, false, 0, '', [], {}]) await json({ querystring: value })
    expect(configs.slice(3, 9).map((config) => config.url)).toEqual(['/json?null', '/json?false', '/json?0', '/json?%22%22', '/json?%5B%5D', '/json?%7B%7D'])
    await json({ querystring: { z: { b: 1, a: 2 }, a: ' #?&=中' } })
    expect(configs.at(-1)?.url).toBe('/json?%7B%22a%22%3A%22%20%23%3F%26%3D%E4%B8%AD%22%2C%22z%22%3A%7B%22a%22%3A2%2C%22b%22%3A1%7D%7D')
    await form({ querystring: { a: 'from-input' } }, { url: '/override', params: { escape: true } })
    expect(configs.at(-1)).toEqual(expect.objectContaining({ url: '/override', params: { escape: true } }))
    await expect(form({ querystring: {} })).rejects.toThrow('no pairs')
    await expect(form({ querystring: { a: [] } })).rejects.toThrow('array length')
    await expect(form({ querystring: { a: undefined } })).rejects.toThrow('no pairs')
    await form({ querystring: { a: undefined, b: ['x'] } })
    expect(configs.at(-1)).toEqual(expect.objectContaining({ url: '/form?b=x' }))
    const afterOptional = configs.length
    await expect(form({ querystring: Object.defineProperty({}, 'a', { get: () => 'unsafe', enumerable: true }) })).rejects.toThrow('unsafe object')
    await expect(json({ querystring: { toJSON: () => ({}) } })).rejects.toThrow('custom toJSON')
    await expect(json({ querystring: { x: Number.NaN } })).rejects.toThrow('unsupported JSON value')
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    await expect(json({ querystring: cycle })).rejects.toThrow('unsupported JSON value')
    await expect(form({ querystring: { a: 'x'.repeat(9_000) } })).rejects.toThrow('byte limit')
    expect(configs).toHaveLength(afterOptional)
  })
})
