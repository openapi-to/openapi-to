import { describe, expect, it } from 'vitest'

import type { CompatibleOpenAPIDocument, OpenAPIDocument, OperationWrapper } from '../../types/index.ts'
import { buildOperationCatalog } from '../catalog/builder.ts'
import { compileOpenAPI, type OpenAPICompilation } from '../compiler.ts'
import { buildOpenAPIReferenceGraph, resolveOpenAPIComponentClosure } from './reference-graph.ts'
import { projectOpenAPICompilation, projectOpenAPIDocument } from './project.ts'
import { PluginManager } from '../../pluginManager/PluginManager.ts'

function mutableAt(value: unknown, path: string[]): Record<string, unknown> {
  let current = value
  for (const key of path) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) throw new TypeError(`Expected object at ${path.join('/')}.`)
    current = (current as Record<string, unknown>)[key]
  }
  if (typeof current !== 'object' || current === null || Array.isArray(current)) throw new TypeError(`Expected object at ${path.join('/')}.`)
  return current as Record<string, unknown>
}

function valueAt(value: unknown, path: Array<string | number>): unknown {
  let current = value
  for (const key of path) {
    if (Array.isArray(current)) {
      if (typeof key !== 'number') return undefined
      current = current[key]
    } else if (typeof current === 'object' && current !== null) current = (current as Record<string, unknown>)[String(key)]
    else return undefined
  }
  return current
}

function document(version = '3.1.0'): CompatibleOpenAPIDocument {
  return {
    openapi: version,
    info: { title: 'Projection', version: '1' },
    servers: [{ url: 'https://example.test' }],
    security: [{ oauth: ['read'] }],
    tags: [{ name: 'users' }, { name: 'admin' }],
    paths: {
      '/users/{id}': {
        parameters: [{ $ref: '#/components/parameters/UserId' }],
        get: {
          operationId: 'getUser',
          tags: ['users'],
          responses: { '200': { $ref: '#/components/responses/UserResponse' } },
        },
        delete: { operationId: 'deleteUser', tags: ['admin'], responses: { '204': { description: 'Deleted' } } },
      },
      '/users': {
        post: {
          operationId: 'createUser',
          tags: ['users'],
          security: [],
          requestBody: { $ref: '#/components/requestBodies/UserBody' },
          responses: { '201': { description: 'Created', headers: { trace: { $ref: '#/components/headers/Trace' } } } },
        },
      },
      '/health': { get: { operationId: 'health', responses: { '2XX': { description: 'Healthy' } } } },
    },
    components: {
      schemas: {
        User: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' }, manager: { $ref: '#/components/schemas/User' } },
          allOf: [{ $ref: '#/components/schemas/Audit' }],
          discriminator: { propertyName: 'kind', mapping: { admin: '#/components/schemas/Admin' } },
        },
        Admin: { oneOf: [{ $ref: '#/components/schemas/User' }] },
        Audit: {
          type: 'object',
          prefixItems: [{ $ref: '#/components/schemas/Label' }],
          not: { $ref: '#/components/schemas/Forbidden' },
          additionalProperties: { $ref: '#/components/schemas/Label' },
          contains: { $ref: '#/components/schemas/Label' },
          dependentSchemas: { value: { $ref: '#/components/schemas/Label' } },
          propertyNames: { $ref: '#/components/schemas/Label' },
        },
        Label: { type: 'string' },
        Forbidden: { type: 'null' },
        Unused: { type: 'boolean' },
      },
      parameters: { UserId: { name: 'id', in: 'path', required: true, schema: { type: 'string' } } },
      requestBodies: { UserBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } } },
      responses: {
        UserResponse: {
          description: 'User',
          headers: { trace: { $ref: '#/components/headers/Trace' } },
          content: { 'application/json': { schema: { $ref: '#/components/schemas/User' }, examples: { one: { $ref: '#/components/examples/UserExample' } } } },
          links: { self: { $ref: '#/components/links/UserLink' } },
        },
      },
      headers: {
        Trace: { schema: { $ref: '#/components/schemas/Label' } },
        UnusedHeader: { schema: { type: 'boolean' } },
      },
      securitySchemes: { oauth: { type: 'oauth2', flows: {} } },
      callbacks: { Changed: { '{$request.body#/callback}': { post: { security: [{ oauth: [] }], responses: { '200': { description: 'ok' } } } } } },
      links: { UserLink: { operationId: 'getUser' } },
      examples: { UserExample: { value: { id: '1' } } },
    },
  } as CompatibleOpenAPIDocument
}

describe('OpenAPI projection reference graph', () => {
  it('preserves $self and info.summary, closes selected tag ancestors, and excludes unrelated tags', () => {
    const source = {
      openapi: '3.2.1', $self: 'https://example.test/openapi.yaml',
      info: { title: 'Tag projection', summary: 'API summary', version: '1' },
      tags: [
        { name: 'root', summary: 'Root summary', kind: 'nav', description: 'Root description', externalDocs: { url: 'https://example.test/root' }, 'x-meta': { retained: true } },
        { name: 'child', parent: 'root', summary: 'Child summary', kind: 'audience' },
        { name: 'unrelated' }, { name: 'unrelated-child', parent: 'unrelated' },
      ],
      paths: {
        '/child': { get: { operationId: 'getChild', tags: ['child'], responses: { '200': { description: 'ok' } } } },
        '/unrelated': { get: { operationId: 'getUnrelated', tags: ['unrelated-child'], responses: { '200': { description: 'ok' } } } },
      },
    } as CompatibleOpenAPIDocument
    const catalog = buildOperationCatalog(source, { target: 'backend', resolvedDocument: source })
    const first = projectOpenAPIDocument(source, source, catalog, { type: 'operations', operationKeys: ['getChild'] }, { target: 'backend' })
    const second = projectOpenAPIDocument(source, source, catalog, { type: 'operations', operationKeys: ['getChild'] }, { target: 'backend' })
    expect(first.success).toBe(true)
    expect(first.document).toMatchObject({
      $self: 'https://example.test/openapi.yaml',
      info: { summary: 'API summary' },
      tags: [source.tags?.[0], source.tags?.[1]],
    })
    expect(first.resolvedDocument).toMatchObject({ $self: 'https://example.test/openapi.yaml', info: { summary: 'API summary' } })
    expect(first.projectionHash).toBe(second.projectionHash)
    expect(first.document?.tags?.map((tag) => tag.name)).toEqual(['root', 'child'])
  })

  it.each(['3.0.3', '3.1.0'])('does not apply OpenAPI 3.2 root metadata projection to %s', (version) => {
    const source = {
      openapi: version, $self: 'https://example.test/legacy.yaml',
      info: { title: 'Legacy projection', version: '1' },
      tags: [{ name: 'root' }, { name: 'child', parent: 'root' }],
      paths: { '/child': { get: { operationId: 'getChild', tags: ['child'], responses: { '200': { description: 'ok' } } } } },
    } as unknown as CompatibleOpenAPIDocument
    const catalog = buildOperationCatalog(source, { target: 'backend', resolvedDocument: source })
    const projected = projectOpenAPIDocument(source, source, catalog, { type: 'operations', operationKeys: ['getChild'] }, { target: 'backend' })
    expect(projected.success).toBe(true)
    expect(projected.document).not.toHaveProperty('$self')
    expect(projected.document?.tags?.map((tag) => tag.name)).toEqual(['child'])
  })

  it('preserves OpenAPI 3.2 dataValue and serializedValue across selective example-reference closure', async () => {
    const source = {
      openapi: '3.2.1', $self: './api.yaml',
      info: { title: 'Example projection', summary: 'Kept', version: '1' },
      paths: { '/items': { get: {
        operationId: 'getItems',
        parameters: [{ name: 'q', in: 'query', schema: { type: 'string' }, examples: { inlineParameter: { dataValue: 'schema-ready', serializedValue: 'wire%20value' } } }],
        requestBody: { content: { 'application/json': { examples: { inlineRequest: { dataValue: { id: '1' }, summary: 'Request example' } } } } },
        responses: { '200': { description: 'ok', headers: { 'X-Example': { examples: { inlineHeader: { serializedValue: 'header-wire' } } } }, content: { 'application/json': { examples: {
          referenced: { $ref: '#/components/examples/Referenced' },
          inlineResponse: { dataValue: { id: '2' }, serializedValue: '{"id":"2"}' },
        } } } } },
      } } },
      components: { examples: { Referenced: { summary: 'Reusable', dataValue: { id: '3' }, serializedValue: '{"id":"3"}' } } },
    } as unknown as CompatibleOpenAPIDocument
    const compilation = await compileOpenAPI(source as unknown as Record<string, unknown>)
    expect(compilation.success).toBe(true)
    if (!compilation.resolvedDocument) throw new TypeError('Compilation must produce a resolved document.')
    const catalog = buildOperationCatalog(source, { target: 'backend', resolvedDocument: compilation.resolvedDocument })
    const first = projectOpenAPIDocument(source, compilation.resolvedDocument, catalog, { type: 'operations', operationKeys: ['getItems'] }, { target: 'backend' })
    const second = projectOpenAPIDocument(source, compilation.resolvedDocument, catalog, { type: 'operations', operationKeys: ['getItems'] }, { target: 'backend' })
    expect(first.success).toBe(true)
    expect(first.includedComponents.examples).toEqual(['Referenced'])
    expect(valueAt(first.document, ['components', 'examples', 'Referenced'])).toEqual(valueAt(source, ['components', 'examples', 'Referenced']))
    expect(valueAt(first.document, ['paths', '/items', 'get', 'parameters', 0, 'examples', 'inlineParameter'])).toEqual({ dataValue: 'schema-ready', serializedValue: 'wire%20value' })
    expect(valueAt(first.document, ['paths', '/items', 'get', 'requestBody', 'content', 'application/json', 'examples', 'inlineRequest'])).toMatchObject({ dataValue: { id: '1' } })
    expect(valueAt(first.document, ['paths', '/items', 'get', 'responses', '200', 'headers', 'X-Example', 'examples', 'inlineHeader'])).toEqual({ serializedValue: 'header-wire' })
    expect(valueAt(first.resolvedDocument, ['paths', '/items', 'get', 'responses', '200', 'content', 'application/json', 'examples', 'referenced'])).toEqual(valueAt(source, ['components', 'examples', 'Referenced']))
    expect(valueAt(first.document, ['paths', '/items', 'get', 'responses', '200', 'content', 'application/json', 'examples', 'inlineResponse'])).toEqual({ dataValue: { id: '2' }, serializedValue: '{"id":"2"}' })
    expect(first.projectionHash).toBe(second.projectionHash)
  })

  it('ignores Media Type Reference Object siblings in selected path-item parameters', async () => {
    const source = {
      openapi: '3.2.1', info: { title: 'Path parameter media', version: '1' },
      paths: { '/x': {
        parameters: [{ name: 'p', in: 'query', content: { 'multipart/mixed': {
          $ref: '#/components/mediaTypes/Shared', schema: { $ref: '#/components/schemas/Missing' },
        } } }],
        get: { operationId: 'getX', responses: { '200': { description: 'ok' } } },
      } },
      components: { mediaTypes: { Shared: { itemSchema: { type: 'string' } } } },
    } as unknown as CompatibleOpenAPIDocument
    const compiled = await compileOpenAPI(source as unknown as Record<string, unknown>)
    expect(compiled.success).toBe(true)
    if (!compiled.resolvedDocument) throw new Error('Compilation must produce a resolved document.')
    const catalog = buildOperationCatalog(source, { resolvedDocument: compiled.resolvedDocument })
    const first = projectOpenAPIDocument(source, compiled.resolvedDocument, catalog, { type: 'operations', operationKeys: ['getX'] })
    const second = projectOpenAPIDocument(source, compiled.resolvedDocument, catalog, { type: 'operations', operationKeys: ['getX'] })
    expect(first.success).toBe(true)
    expect(first.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'PROJECTION_REFERENCE_NOT_FOUND' }))
    expect(first.includedComponents.mediaTypes).toEqual(['Shared'])
    expect(first.includedComponents.schemas).toEqual([])
    expect(first.projectionHash).toBe(second.projectionHash)
  })

  it('preserves OpenAPI 3.2 item and positional Encoding references in full and selective compilation', async () => {
    const source = {
      openapi: '3.2.1', info: { title: 'Media projection', version: '1' },
      paths: { '/events': { post: { operationId: 'publishEvents', requestBody: { $ref: '#/components/requestBodies/EventBody' }, responses: { '200': { $ref: '#/components/responses/EventResponse' } } } }, '/unused': { get: { operationId: 'unused', responses: { '200': { description: 'ok' } } } } },
      components: {
        schemas: { Event: { type: 'object' }, Unused: { type: 'string' } },
        mediaTypes: { Shared: { itemSchema: { $ref: '#/components/schemas/Event' }, prefixEncoding: [{ contentType: 'multipart/mixed' }] } },
        headers: { Prefix: { schema: { type: 'string' } }, Item: { schema: { type: 'string' } }, Nested: { schema: { type: 'string' } } },
        requestBodies: { EventBody: { content: { 'application/jsonl': { itemSchema: { $ref: '#/components/schemas/Event' } }, 'multipart/mixed': { $ref: '#/components/mediaTypes/Shared', schema: { $ref: '#/components/schemas/Unused' }, encoding: {}, itemEncoding: {} }, 'multipart/related; type="application/json"': { prefixEncoding: [{ contentType: 'multipart/mixed', headers: { Prefix: { $ref: '#/components/headers/Prefix' } }, itemEncoding: { headers: { Nested: { $ref: '#/components/headers/Nested' } } } }], itemEncoding: { headers: { Item: { $ref: '#/components/headers/Item' } } } } } } },
        responses: { EventResponse: { description: 'ok', content: { 'application/jsonl': { itemSchema: { $ref: '#/components/schemas/Event' } } } } },
      },
    } as unknown as CompatibleOpenAPIDocument
    const full = await compileOpenAPI(source as unknown as Record<string, unknown>)
    const repeatedFull = await compileOpenAPI(source as unknown as Record<string, unknown>)
    expect(full.success).toBe(true)
    expect(full.document).toEqual(source)
    expect(valueAt(full.resolvedDocument, ['components', 'requestBodies', 'EventBody', 'content', 'multipart/mixed'])).toEqual({ itemSchema: { type: 'object' }, prefixEncoding: [{ contentType: 'multipart/mixed' }] })
    expect(JSON.stringify(full.normalizedDocument)).toBe(JSON.stringify(repeatedFull.normalizedDocument))
    if (!full.resolvedDocument) throw new Error('Full compilation must produce a resolved document.')
    const catalog = buildOperationCatalog(source, { resolvedDocument: full.resolvedDocument })
    const first = projectOpenAPIDocument(source, full.resolvedDocument, catalog, { type: 'operations', operationKeys: ['publishEvents'] })
    const second = projectOpenAPIDocument(source, full.resolvedDocument, catalog, { type: 'operations', operationKeys: ['publishEvents'] })
    expect(first.success).toBe(true)
    expect(first.includedComponents).toMatchObject({ schemas: ['Event'], mediaTypes: ['Shared'], headers: ['Item', 'Nested', 'Prefix'], requestBodies: ['EventBody'], responses: ['EventResponse'] })
    expect(first.projectionHash).toBe(second.projectionHash)
    expect(JSON.stringify(first.document)).toBe(JSON.stringify(second.document))
    expect(valueAt(first.document, ['components', 'requestBodies', 'EventBody'])).toEqual(valueAt(source, ['components', 'requestBodies', 'EventBody']))
    expect(valueAt(first.document, ['components', 'mediaTypes', 'Shared'])).toEqual(valueAt(source, ['components', 'mediaTypes', 'Shared']))
    expect(valueAt(first.document, ['components', 'responses', 'EventResponse'])).toEqual(valueAt(source, ['components', 'responses', 'EventResponse']))
    expect(valueAt(first.document, ['components', 'schemas', 'Unused'])).toBeUndefined()
  })
  it('collects a deterministic multi-kind component closure and terminates cycles', () => {
    const source = document()
    const graph = buildOpenAPIReferenceGraph(source)
    const closure = resolveOpenAPIComponentClosure(
      graph,
      [{ $ref: '#/components/responses/UserResponse' }, { $ref: '#/components/requestBodies/UserBody' }],
      ['oauth'],
      { target: 'backend' },
    )
    expect(closure.references).toEqual([
      '#/components/examples/UserExample',
      '#/components/headers/Trace',
      '#/components/links/UserLink',
      '#/components/requestBodies/UserBody',
      '#/components/responses/UserResponse',
      '#/components/schemas/Admin',
      '#/components/schemas/Audit',
      '#/components/schemas/Forbidden',
      '#/components/schemas/Label',
      '#/components/schemas/User',
      '#/components/securitySchemes/oauth',
    ])
    expect(closure.diagnostics).toContainEqual(expect.objectContaining({ code: 'PROJECTION_REFERENCE_CYCLE' }))
  })

  it('reports a missing required component', () => {
    const graph = buildOpenAPIReferenceGraph(document())
    const closure = resolveOpenAPIComponentClosure(graph, [{ $ref: '#/components/schemas/Missing' }])
    expect(closure.diagnostics).toContainEqual(expect.objectContaining({ code: 'PROJECTION_REFERENCE_NOT_FOUND', severity: 'error' }))
  })

  it('collects security requirements nested in callback components', () => {
    const graph = buildOpenAPIReferenceGraph(document())
    const closure = resolveOpenAPIComponentClosure(graph, [{ $ref: '#/components/callbacks/Changed' }])
    expect(closure.references).toEqual(['#/components/callbacks/Changed', '#/components/securitySchemes/oauth'])
  })
})

describe.each(['3.0.3', '3.1.0', '3.2.0'])('projectOpenAPIDocument OpenAPI %s', (version) => {
  it('keeps selected methods, inherited roots, tags, and only the component closure', () => {
    const source = document(version)
    const catalog = buildOperationCatalog(source, { target: 'backend', resolvedDocument: source })
    const first = projectOpenAPIDocument(source, source, catalog, { type: 'operations', operationKeys: ['getUser'] }, { target: 'backend', sourceHash: 'root-hash' })
    const second = projectOpenAPIDocument(source, source, catalog, { type: 'operations', operationKeys: ['getUser', 'getUser'] }, { target: 'backend', sourceHash: 'root-hash' })
    expect(first.success).toBe(true)
    expect(first.selection.resolvedOperationKeys).toEqual(['getUser'])
    expect(first.projectionHash).toBe(second.projectionHash)
    expect(first.stats).toMatchObject({ operationCount: 1, pathCount: 1, schemaCount: 5, parameterCount: 1, responseCount: 1, headerCount: 1, securitySchemeCount: 1 })
    expect(valueAt(first.document, ['paths', '/users/{id}', 'get', 'operationId'])).toBe('getUser')
    expect(valueAt(first.document, ['paths', '/users/{id}', 'delete'])).toBeUndefined()
    expect(valueAt(first.document, ['paths', '/users/{id}', 'parameters'])).toBeDefined()
    expect(valueAt(first.document, ['tags'])).toEqual([{ name: 'users' }])
    expect(valueAt(first.document, ['security'])).toEqual([{ oauth: ['read'] }])
    expect(Object.keys(mutableAt(first.document, ['components', 'schemas']))).toEqual(['Admin', 'Audit', 'Forbidden', 'Label', 'User'])
    expect(valueAt(first.document, ['components', 'schemas', 'Unused'])).toBeUndefined()
    expect(Object.keys(mutableAt(first.document, ['components', 'headers']))).toEqual(['Trace'])
    expect(valueAt(first.document, ['components', 'headers', 'Trace', 'schema'])).toEqual({ $ref: '#/components/schemas/Label' })
    expect(valueAt(first.document, ['components', 'headers', 'UnusedHeader'])).toBeUndefined()
  })
})

describe('projectOpenAPICompilation selection validation', () => {
	it('preserves inherited querystring parameter and schema refs in selective OpenAPI 3.2 projection', () => {
		const source = {
			openapi: '3.2.1', info: { title: 'Querystring projection', version: '1' },
			paths: { '/items': { parameters: [{ $ref: '#/components/parameters/Filter' }], get: { operationId: 'listItems', responses: { '200': { description: 'ok' } } }, query: { operationId: 'queryItems', responses: { '200': { description: 'ok' } } } } },
			components: { parameters: { Filter: { name: 'filter', in: 'querystring', content: { 'application/json': { schema: { $ref: '#/components/schemas/Filter' } } } } }, schemas: { Filter: { type: 'object', properties: { q: { type: 'string' } } }, Unused: { type: 'string' } } },
		} as unknown as CompatibleOpenAPIDocument
		const catalog = buildOperationCatalog(source, { resolvedDocument: source })
		const first = projectOpenAPIDocument(source, source, catalog, { type: 'operations', operationKeys: ['listItems'] })
		const second = projectOpenAPIDocument(source, source, catalog, { type: 'operations', operationKeys: ['listItems'] })
		expect(first.success).toBe(true)
		expect(first.projectionHash).toBe(second.projectionHash)
		expect(valueAt(first.document, ['paths', '/items', 'parameters'])).toEqual([{ $ref: '#/components/parameters/Filter' }])
		expect(valueAt(first.document, ['components', 'parameters', 'Filter', 'in'])).toBe('querystring')
		expect(valueAt(first.document, ['components', 'schemas', 'Filter'])).toBeDefined()
		expect(valueAt(first.document, ['components', 'schemas', 'Unused'])).toBeUndefined()
		expect(valueAt(first.document, ['paths', '/items', 'query'])).toBeUndefined()
	})
	it('projects OpenAPI 3.2 QUERY and exact additional-operation slots', async () => {
    const source = {
      openapi: '3.2.0', info: { title: 'Projection 3.2', version: '1' },
      paths: { '/mixed': {
        get: { operationId: 'getMixed', responses: { '200': { description: 'ok' } } },
        query: { operationId: 'queryMixed', responses: { '200': { description: 'ok' } } },
        additionalOperations: { FoO: { operationId: 'fooMixed', responses: { '204': { description: 'ok' } } } },
      } },
    } as unknown as CompatibleOpenAPIDocument
    const catalog = buildOperationCatalog(source, { target: 'backend', resolvedDocument: source })
    const result = projectOpenAPIDocument(source, source, catalog, { type: 'operations', operationKeys: ['queryMixed', 'fooMixed'] }, { target: 'backend' })
    expect(result.success).toBe(true)
    expect(valueAt(result.document, ['paths', '/mixed', 'get'])).toBeUndefined()
    expect(valueAt(result.document, ['paths', '/mixed', 'query', 'operationId'])).toBe('queryMixed')
    expect(valueAt(result.document, ['paths', '/mixed', 'additionalOperations', 'FoO', 'operationId'])).toBe('fooMixed')
    expect(result.diagnostics.map(({ code }) => code)).not.toContain('SELECTIVE_GENERATION_UNSUPPORTED_OPERATION')

    const seen: Array<{ sourceKind: string; sourceMethod: string; wireMethod: string }> = []
    const manager = new PluginManager({
      name: 'backend', root: '.', input: { path: 'unused' }, output: { dir: 'unused' },
      plugins: [{ name: 'projection-3.2-observer', hooks: { operation(operation: OperationWrapper) {
        seen.push({ sourceKind: operation.sourceKind, sourceMethod: operation.sourceMethod, wireMethod: operation.wireMethod })
      } } }],
    }, result.document as OpenAPIDocument)
    await manager.execute()
    expect(seen).toEqual([
      { sourceKind: 'fixed', sourceMethod: 'query', wireMethod: 'QUERY' },
      { sourceKind: 'additional', sourceMethod: 'FoO', wireMethod: 'FoO' },
    ])
	})

  it('preserves prototype-sensitive additional-operation slots through projection and plugins', async () => {
    const source = JSON.parse('{"openapi":"3.2.0","info":{"title":"safe","version":"1"},"paths":{"/safe":{"additionalOperations":{"__proto__":{"operationId":"safeProto","responses":{"200":{"description":"ok"}}}}}}}') as CompatibleOpenAPIDocument
    const catalog = buildOperationCatalog(source, { target: 'backend', resolvedDocument: source })
    const result = projectOpenAPIDocument(source, source, catalog, { type: 'operations', operationKeys: ['safeProto'] }, { target: 'backend' })
    expect(result.success).toBe(true)
    const additionalOperations = mutableAt(result.document, ['paths', '/safe', 'additionalOperations'])
    expect(Object.hasOwn(additionalOperations, '__proto__')).toBe(true)
    expect(valueAt(additionalOperations, ['__proto__', 'operationId'])).toBe('safeProto')

    const seen: string[] = []
    const manager = new PluginManager({
      name: 'backend', root: '.', input: { path: 'unused' }, output: { dir: 'unused' },
      plugins: [{ name: 'safe-proto-observer', hooks: { operation(operation: OperationWrapper) {
        seen.push(operation.sourceMethod)
      } } }],
    }, result.document as OpenAPIDocument)
    await manager.execute()
    expect(seen).toEqual(['__proto__'])
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined()
  })

  it('normalizes selection order and returns a stable projected compilation', () => {
    const source = document()
    const catalog = buildOperationCatalog(source, { target: 'backend', resolvedDocument: source })
    const compilation: OpenAPICompilation = { success: true, source: 'fixture', uri: 'file:///fixture.json', version: '3.1.0', document: source, resolvedDocument: source, normalizedDocument: source, diagnostics: [] }
    const left = projectOpenAPICompilation(compilation, catalog, { type: 'operations', operationKeys: ['createUser', 'getUser'] }, { target: 'backend', sourceHash: 'same' })
    const right = projectOpenAPICompilation(compilation, catalog, { type: 'operations', operationKeys: ['getUser', 'createUser'] }, { target: 'backend', sourceHash: 'same' })
    expect(left.success).toBe(true)
    expect(left.projectionHash).toBe(right.projectionHash)
    expect(left.compilation?.document).toEqual(right.compilation?.document)
  })

  it.each([
    { keys: [], code: 'EMPTY_OPERATION_SELECTION' },
    { keys: ['missing'], code: 'UNKNOWN_OPERATION_KEY' },
  ])('rejects $code', ({ keys, code }) => {
    const source = document()
    const catalog = buildOperationCatalog(source, { target: 'backend', resolvedDocument: source })
    const result = projectOpenAPIDocument(source, source, catalog, { type: 'operations', operationKeys: keys }, { target: 'backend' })
    expect(result.success).toBe(false)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code, severity: 'error' }))
  })

  it('rejects a catalog from another target', () => {
    const source = document()
    const catalog = buildOperationCatalog(source, { target: 'target-a', resolvedDocument: source })
    const result = projectOpenAPIDocument(source, source, catalog, { type: 'operations', operationKeys: ['getUser'] }, { target: 'target-b' })
    expect(result.success).toBe(false)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'OPERATION_SELECTION_TARGET_MISMATCH' }))
  })

  it('blocks missing and duplicate operationIds without changing catalog fallback identity', () => {
    const source = structuredClone(document())
    delete mutableAt(source, ['paths', '/health', 'get']).operationId
    mutableAt(source, ['paths', '/users', 'post']).operationId = 'getUser'
    const catalog = buildOperationCatalog(source, { target: 'backend', resolvedDocument: source })
    const missing = projectOpenAPIDocument(source, source, catalog, { type: 'operations', operationKeys: ['GET /health'] }, { target: 'backend' })
    const duplicate = projectOpenAPIDocument(source, source, catalog, { type: 'operations', operationKeys: ['GET /users/{id}'] }, { target: 'backend' })
    expect(missing.diagnostics).toContainEqual(expect.objectContaining({ code: 'SELECTIVE_GENERATION_OPERATION_ID_REQUIRED' }))
    expect(duplicate.diagnostics).toContainEqual(expect.objectContaining({ code: 'SELECTIVE_GENERATION_DUPLICATE_OPERATION_ID' }))
  })

  it('reuses an already-resolved external reference without reading a source', () => {
    const source = structuredClone(document())
    mutableAt(source, ['paths', '/users/{id}', 'get', 'responses'])['200'] = { $ref: './responses.yaml#/User' }
    const resolved = structuredClone(source)
    mutableAt(resolved, ['paths', '/users/{id}', 'get', 'responses'])['200'] = { description: 'External', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } }
    const catalog = buildOperationCatalog(source, { target: 'backend', resolvedDocument: resolved })
    const result = projectOpenAPIDocument(source, resolved, catalog, { type: 'operations', operationKeys: ['getUser'] }, { target: 'backend' })
    expect(result.success).toBe(true)
    expect(valueAt(result.document, ['paths', '/users/{id}', 'get', 'responses', '200'])).toMatchObject({ description: 'External' })
    expect(valueAt(result.document, ['components', 'schemas', 'User'])).toBeDefined()
  })

  it('lets the unchanged PluginManager see only selected operations and closed schemas', async () => {
    const source = document()
    const catalog = buildOperationCatalog(source, { target: 'backend', resolvedDocument: source })
    const compilation: OpenAPICompilation = { success: true, source: 'fixture', uri: 'file:///fixture.json', version: '3.1.0', document: source, resolvedDocument: source, normalizedDocument: source, diagnostics: [] }
    const projected = projectOpenAPICompilation(compilation, catalog, { type: 'operations', operationKeys: ['getUser'] }, { target: 'backend' })
    if (!projected.compilation?.document) throw new TypeError('Expected projected compilation document.')
    const operations: string[] = []
    const schemas: string[][] = []
    const manager = new PluginManager(
      {
        name: 'backend', root: '.', input: { path: 'unused' }, output: { dir: 'unused' },
        plugins: [{
          name: 'projection-observer',
          hooks: {
            operation(operation: OperationWrapper) { operations.push(operation.accessor.operationId) },
            componentsSchemas(value: Record<string, unknown>) { schemas.push(Object.keys(value)) },
          },
        }],
      },
      projected.compilation.document as OpenAPIDocument,
    )
    await manager.execute()
    expect(operations).toEqual(['getUser'])
    expect(schemas).toEqual([['Admin', 'Audit', 'Forbidden', 'Label', 'User']])
  })

  it('keeps identical operation keys isolated between targets', () => {
    const first = structuredClone(document())
    const second = structuredClone(document())
    mutableAt(second, ['components', 'schemas', 'User', 'properties']).target = { const: 'second' }
    const firstResult = projectOpenAPIDocument(first, first, buildOperationCatalog(first, { target: 'a' }), { type: 'operations', operationKeys: ['getUser'] }, { target: 'a', sourceHash: 'a' })
    const secondResult = projectOpenAPIDocument(second, second, buildOperationCatalog(second, { target: 'b' }), { type: 'operations', operationKeys: ['getUser'] }, { target: 'b', sourceHash: 'b' })
    expect(firstResult.projectionHash).not.toBe(secondResult.projectionHash)
    expect(valueAt(firstResult.document, ['components', 'schemas', 'User', 'properties', 'target'])).toBeUndefined()
    expect(valueAt(secondResult.document, ['components', 'schemas', 'User', 'properties', 'target'])).toEqual({ const: 'second' })
  })
})
