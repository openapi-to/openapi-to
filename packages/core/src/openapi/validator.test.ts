import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { compileOpenAPI } from './compiler.ts'
import { resolveJSONPointer } from './refResolver.ts'

const fixtureRoot = path.dirname(fileURLToPath(import.meta.url))

describe('OpenAPI validator', () => {
  it('checks nested form encoding and reusable media encoding at their source paths', async () => {
    const result = await compileOpenAPI({
      openapi: '3.2.1', info: { title: 'nested media', version: '1' },
      paths: { '/events': { post: {
        requestBody: { content: { 'multipart/mixed': { $ref: '#/components/mediaTypes/Shared' } } },
        responses: { '200': { description: 'ok', content: { 'multipart/mixed': { prefixEncoding: [{ contentType: 'application/x-www-form-urlencoded', encoding: {}, itemEncoding: {} }] } } } },
      } } },
      components: { mediaTypes: { Shared: { itemEncoding: { contentType: 'multipart/mixed', encoding: {}, itemEncoding: {} } } } },
    })
    expect(result.diagnostics.filter(({ code }) => code === 'OPENAPI_32_ENCODING_CONFLICT').map(({ location }) => location?.path)).toEqual([
      ['components', 'mediaTypes', 'Shared', 'itemEncoding', 'itemEncoding'],
      ['paths', '/events', 'post', 'responses', '200', 'content', 'multipart/mixed', 'prefixEncoding', 0, 'itemEncoding'],
    ])
  })
  it('checks nested Encoding through a reusable Media Type reference chain', async () => {
    const result = await compileOpenAPI({
      openapi: '3.2.1', info: { title: 'media reference chain', version: '1' },
      paths: { '/events': { post: { requestBody: { content: { 'multipart/mixed': { $ref: '#/components/mediaTypes/A' } } }, responses: { '200': { description: 'ok' } } } } },
      components: { mediaTypes: { A: { $ref: '#/components/mediaTypes/B' }, B: { itemEncoding: { contentType: 'multipart/mixed', encoding: {}, itemEncoding: {} } } } },
    })
    expect(result.diagnostics.filter(({ code }) => code === 'OPENAPI_32_ENCODING_CONFLICT').map(({ location }) => location?.path)).toEqual([
      ['components', 'mediaTypes', 'B', 'itemEncoding', 'itemEncoding'],
    ])
  })
  it('ignores extra Media Type Reference Object fields at content and component chain nodes', async () => {
    const result = await compileOpenAPI({
      openapi: '3.2.1', info: { title: 'media reference siblings', version: '1' },
      paths: { '/events': { post: { requestBody: { content: { 'multipart/mixed': { $ref: '#/components/mediaTypes/A', encoding: {}, itemEncoding: {} } } }, responses: { '200': { description: 'ok' } } } } },
      components: { mediaTypes: { A: { $ref: '#/components/mediaTypes/B', encoding: {}, prefixEncoding: [{}] }, B: { itemEncoding: { contentType: 'application/json' } } } },
    })
    expect(result.success).toBe(true)
    expect(result.diagnostics.map(({ code }) => code)).not.toContain('OPENAPI_32_ENCODING_CONFLICT')
    expect(result.diagnostics.filter(({ code }) => code === 'OPENAPI_32_FIELD_NOT_GENERATED').map(({ location }) => location?.path)).toEqual([
      ['components', 'mediaTypes', 'B', 'itemEncoding'],
    ])
    expect(resolveJSONPointer(result.resolvedDocument, '#/paths/~1events/post/requestBody/content/multipart~1mixed').value).toEqual({ itemEncoding: { contentType: 'application/json' } })
    const ignored = await compileOpenAPI({
      openapi: '3.2.1', info: { title: 'ignored component media', version: '1' },
      paths: { '/events': { get: { responses: { '200': { description: 'ok', content: { 'application/json': { $ref: '#/components/mediaTypes/B' } } } } } } },
      components: { mediaTypes: { B: { itemEncoding: {} } } },
    })
    expect(ignored.success).toBe(true)
    expect(ignored.diagnostics.map(({ code }) => code)).not.toContain('OPENAPI_32_FIELD_NOT_GENERATED')
  })
  it('preserves Schema Object $ref siblings while ignoring Media Type Reference Object metadata siblings', async () => {
    const result = await compileOpenAPI({
      openapi: '3.2.1', info: { title: 'distinct references', version: '1' },
      paths: { '/events': { get: { responses: { '200': { description: 'ok', content: {
        'multipart/mixed': { $ref: '#/components/mediaTypes/Shared', summary: 'shared', description: 'reference', encoding: {}, prefixEncoding: [{}], schema: { type: 'string' } },
        'application/json': { schema: { $ref: '#/components/schemas/Event', description: 'schema sibling' } },
      } } } } } },
      components: { mediaTypes: { Shared: { itemSchema: { type: 'string' } } }, schemas: { Event: { type: 'object' } } },
    })
    expect(result.success).toBe(true)
    expect(result.diagnostics.map(({ code }) => code)).not.toContain('OPENAPI_32_ENCODING_CONFLICT')
    expect(result.diagnostics.filter(({ code }) => code === 'OPENAPI_32_FIELD_NOT_GENERATED').map(({ location }) => location?.path)).toEqual([
      ['components', 'mediaTypes', 'Shared', 'itemSchema'],
    ])
    expect(result.resolvedDocument).toMatchObject({ paths: { '/events': { get: { responses: { '200': { content: { 'application/json': { schema: { type: 'object', description: 'schema sibling' } } } } } } } } })
    expect(resolveJSONPointer(result.resolvedDocument, '#/paths/~1events/get/responses/200/content/multipart~1mixed').value).toEqual({ itemSchema: { type: 'string' }, summary: 'shared', description: 'reference' })
  })
  it('recognizes Media Type references in reusable responses named schema', async () => {
    const result = await compileOpenAPI({
      openapi: '3.2.1', info: { title: 'component name boundary', version: '1' },
      components: { mediaTypes: { Shared: { itemSchema: { type: 'string' } } }, responses: { schema: { description: 'ok', content: { 'multipart/mixed': { $ref: '#/components/mediaTypes/Shared', encoding: {}, itemEncoding: {} } } } } },
    })
    expect(result.success).toBe(true)
    expect(resolveJSONPointer(result.resolvedDocument, '#/components/responses/schema/content/multipart~1mixed').value).toEqual({ itemSchema: { type: 'string' } })
  })
  it('recognizes Media Type references under a webhook named schema', async () => {
    const result = await compileOpenAPI({
      openapi: '3.2.1', info: { title: 'webhook name boundary', version: '1' },
      webhooks: { schema: { post: { requestBody: { content: { 'multipart/mixed': { $ref: '#/components/mediaTypes/Shared', schema: { type: 'string' }, encoding: {}, prefixEncoding: [{}] } } }, responses: { '200': { description: 'ok' } } } } },
      components: { mediaTypes: { Shared: { itemSchema: { type: 'string' } } } },
    })
    expect(result.success).toBe(true)
    expect(resolveJSONPointer(result.resolvedDocument, '#/webhooks/schema/post/requestBody/content/multipart~1mixed').value).toEqual({ itemSchema: { type: 'string' } })
    expect(result.diagnostics.map(({ code }) => code)).not.toContain('OPENAPI_32_ENCODING_CONFLICT')
  })
  it('checks media conflicts in webhooks and callback operations', async () => {
    const result = await compileOpenAPI({
      openapi: '3.2.1', info: { title: 'out of band media', version: '1' },
      paths: { '/subscribe': { post: { callbacks: { onEvent: { '{$request.body#/callbackUrl}': { post: { requestBody: { content: { 'multipart/mixed': { encoding: {}, prefixEncoding: [{}] } } }, responses: { '200': { description: 'ok' } } } } } }, responses: { '200': { description: 'ok' } } } } },
      webhooks: { onEvent: { post: { requestBody: { content: { 'multipart/mixed': { encoding: {}, itemEncoding: {} } } }, responses: { '200': { description: 'ok' } } } } },
    })
    expect(result.diagnostics.filter(({ code }) => code === 'OPENAPI_32_ENCODING_CONFLICT').map(({ location }) => location?.path)).toEqual([
      ['paths', '/subscribe', 'post', 'callbacks', 'onEvent', '{$request.body#/callbackUrl}', 'post', 'requestBody', 'content', 'multipart/mixed', 'prefixEncoding'],
      ['webhooks', 'onEvent', 'post', 'requestBody', 'content', 'multipart/mixed', 'itemEncoding'],
    ])
  })
  it('rejects conflicts in reusable media types and multipart candidates of nested Encoding contentType', async () => {
    const result = await compileOpenAPI({
      openapi: '3.2.1', info: { title: 'referenced media', version: '1' },
      paths: { '/events': { post: {
        requestBody: { content: { 'multipart/mixed': { $ref: '#/components/mediaTypes/Shared' } } },
        responses: { '200': { description: 'ok', content: { 'multipart/mixed': { prefixEncoding: [{ contentType: 'multipart/mixed, application/json', encoding: {}, itemEncoding: {} }] } } } },
      } } },
      components: { mediaTypes: { Shared: { encoding: {}, itemEncoding: {} } } },
    })
    expect(result.success).toBe(false)
    expect(result.diagnostics.filter(({ code }) => code === 'OPENAPI_32_ENCODING_CONFLICT').map(({ location }) => location?.path)).toEqual([
      ['components', 'mediaTypes', 'Shared', 'itemEncoding'],
      ['paths', '/events', 'post', 'responses', '200', 'content', 'multipart/mixed', 'prefixEncoding', 0, 'itemEncoding'],
    ])
  })
  it('diagnoses OpenAPI 3.2 media conflicts with exact paths across operation and component content', async () => {
    const document = {
      openapi: '3.2.1', info: { title: 'media', version: '1' },
      paths: { '/events': { post: {
        requestBody: { content: { 'multipart/mixed': { encoding: {}, prefixEncoding: [{}], itemEncoding: {} } } },
        responses: { '200': { description: 'ok', content: { 'application/jsonl': { schema: { type: 'array' }, itemSchema: { type: 'string' } } } } },
      } } },
      components: { requestBodies: { Form: { content: { 'application/x-www-form-urlencoded': { encoding: {}, itemEncoding: {} } } } }, responses: { Multipart: { description: 'ok', content: { 'multipart/related; type="text/html"': { prefixEncoding: [{ contentType: 'multipart/mixed', encoding: {}, prefixEncoding: [{}] }] } } } } },
    }
    const result = await compileOpenAPI(document)
    expect(result.success).toBe(false)
    expect(result.diagnostics.filter(({ code }) => code === 'OPENAPI_32_ENCODING_CONFLICT').map(({ location }) => location?.path)).toEqual([
      ['components', 'requestBodies', 'Form', 'content', 'application/x-www-form-urlencoded', 'itemEncoding'],
      ['components', 'responses', 'Multipart', 'content', 'multipart/related; type="text/html"', 'prefixEncoding', 0, 'prefixEncoding'],
      ['paths', '/events', 'post', 'requestBody', 'content', 'multipart/mixed', 'itemEncoding'],
      ['paths', '/events', 'post', 'requestBody', 'content', 'multipart/mixed', 'prefixEncoding'],
    ])
    expect(result.diagnostics.filter(({ code }) => code === 'OPENAPI_32_ENCODING_CONFLICT').every(({ severity }) => severity === 'error')).toBe(true)
    expect(result.diagnostics.filter(({ code }) => code === 'OPENAPI_32_FIELD_NOT_GENERATED').some(({ location }) => location?.path?.at(-1) === 'encoding')).toBe(false)
    expect(result.diagnostics.map(({ code }) => code)).not.toContain('OPENAPI_32_SCHEMA_CONFLICT')
  })

  it('keeps spec-ignored fields out of generation-gap warnings while active item semantics remain visible', async () => {
    for (const version of ['3.0.3', '3.1.0', '3.2.1']) {
      const result = await compileOpenAPI({ openapi: version, info: { title: 'media', version: '1' }, paths: { '/events': { get: { responses: { '200': { description: 'ok', content: { 'application/json': { itemSchema: { type: 'string' }, prefixEncoding: [{}], itemEncoding: {} }, 'multipart/mixed': { prefixEncoding: [{}], itemEncoding: {} } } } } } } } })
      const fields = result.diagnostics.filter(({ code }) => code === 'OPENAPI_32_FIELD_NOT_GENERATED').map(({ location }) => location?.path?.at(-1))
      if (version === '3.2.1') {
        expect(fields).toEqual(['itemSchema', 'itemEncoding', 'prefixEncoding'])
        expect(result.diagnostics.map(({ code }) => code)).not.toContain('OPENAPI_32_ENCODING_CONFLICT')
      } else expect(fields).toEqual([])
    }
  })

  it('accepts schema plus itemSchema and prefix plus item encoding without treating ignored nested fields as active', async () => {
    const result = await compileOpenAPI({
      openapi: '3.2.1', info: { title: 'legal media', version: '1' },
      paths: { '/events': { post: {
        requestBody: { content: {
          'application/json': { schema: { type: 'array' }, itemSchema: { type: 'object' }, prefixEncoding: [{ contentType: 'multipart/mixed', encoding: {}, prefixEncoding: [{}] }] },
          'multipart/mixed': { prefixEncoding: [{ contentType: 'application/json', prefixEncoding: [{}] }], itemEncoding: {} },
        } },
        responses: { '200': { description: 'ok' } },
      } } },
    })
    expect(result.success).toBe(true)
    expect(result.document && (result.document as Record<string, unknown>).paths).toBeDefined()
    expect(result.diagnostics.map(({ code }) => code)).not.toContain('OPENAPI_32_ENCODING_CONFLICT')
    expect(result.diagnostics.filter(({ code }) => code === 'OPENAPI_32_FIELD_NOT_GENERATED').map(({ location }) => location?.path)).toEqual([
      ['paths', '/events', 'post', 'requestBody', 'content', 'application/json', 'itemSchema'],
      ['paths', '/events', 'post', 'requestBody', 'content', 'multipart/mixed', 'itemEncoding'],
      ['paths', '/events', 'post', 'requestBody', 'content', 'multipart/mixed', 'prefixEncoding'],
    ])
  })
  it('validates effective OpenAPI 3.2 querystring parameters and local overrides', async () => {
    const parameter = (name: string) => ({ name, in: 'querystring', content: { 'application/json': { schema: { type: 'object' } } } })
    const document = (pathParameter: unknown, operationParameters: unknown[], version = '3.2.1') => ({
      openapi: version, info: { title: 'querystring', version: '1' },
      paths: { '/items': { parameters: [pathParameter], get: { operationId: 'listItems', parameters: operationParameters, responses: { '200': { description: 'ok' } } } } },
      components: { parameters: { Filter: parameter('filter') } },
    })
    const override = await compileOpenAPI(document({ $ref: '#/components/parameters/Filter' }, [parameter('filter')]))
    expect(override.success).toBe(true)
    expect(override.diagnostics.map(({ code }) => code)).not.toContain('OPENAPI_QUERYSTRING_MULTIPLE')

    const multiple = await compileOpenAPI(document(parameter('a'), [parameter('b')]))
    expect(multiple.diagnostics).toContainEqual(expect.objectContaining({ code: 'OPENAPI_QUERYSTRING_MULTIPLE', severity: 'error' }))
    const mixed = await compileOpenAPI(document(parameter('a'), [{ name: 'q', in: 'query', schema: { type: 'string' } }]))
    expect(mixed.diagnostics).toContainEqual(expect.objectContaining({ code: 'OPENAPI_QUERYSTRING_QUERY_CONFLICT', severity: 'error' }))
    for (const version of ['3.0.3', '3.1.0']) {
      const legacy = await compileOpenAPI(document(parameter('filter'), [], version))
      expect(legacy.diagnostics).toContainEqual(expect.objectContaining({ code: 'OPENAPI_QUERYSTRING_REQUIRES_32', severity: 'error' }))
    }
  })

  it('rejects malformed querystring Parameter Object fields at their source paths', async () => {
    const result = await compileOpenAPI({
      openapi: '3.2.1', info: { title: 'invalid querystring', version: '1' },
      paths: { '/items': { get: { parameters: [{ name: 'filter', in: 'querystring', schema: { type: 'object' }, style: 'form', explode: true, allowReserved: true }], responses: { '200': { description: 'ok' } } } } },
    })
    for (const code of ['OPENAPI_QUERYSTRING_CONTENT_REQUIRED', 'OPENAPI_QUERYSTRING_SCHEMA_FIELD']) expect(result.diagnostics.map(({ code: actual }) => actual)).toContain(code)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'OPENAPI_QUERYSTRING_SCHEMA_FIELD', location: expect.objectContaining({ path: ['paths', '/items', 'get', 'parameters', 0, 'schema'] }) }))
  })
  it('recognizes OpenAPI 3.2 in compatibility mode', async () => {
    const result = await compileOpenAPI(path.join(fixtureRoot, 'fixtures/openapi-3.2.yaml'))
    expect(result.success).toBe(true)
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'OPENAPI_32_COMPATIBILITY', severity: 'warning' }), expect.objectContaining({ code: 'OPENAPI_32_FIELD_NOT_GENERATED' })]))
    expect(result.diagnostics.filter(({ code }) => code === 'OPENAPI_32_FIELD_NOT_GENERATED').map(({ location }) => location?.path)).not.toEqual(expect.arrayContaining([
      expect.arrayContaining(['query']),
      expect.arrayContaining(['additionalOperations']),
    ]))
  })

  it('accepts valid 3.2 QUERY and exact custom methods', async () => {
    const result = await compileOpenAPI({
      openapi: '3.2.0', info: { title: 'valid', version: '1' },
      paths: { '/mixed': {
        query: { operationId: 'queryMixed', responses: { '200': { description: 'ok' } } },
        additionalOperations: {
          FIND: { operationId: 'findMixed', responses: { '200': { description: 'ok' } } },
          FoO: { operationId: 'fooMixed', responses: { '204': { description: 'ok' } } },
          'custom-token': { operationId: 'customMixed', responses: { default: { description: 'ok' } } },
        },
      } },
    })
    expect(result.success).toBe(true)
    expect(result.diagnostics.map(({ code }) => code)).not.toEqual(expect.arrayContaining([
      'OPENAPI_32_FIELD_NOT_GENERATED', 'OPENAPI_ADDITIONAL_OPERATION_METHOD_INVALID', 'OPENAPI_ADDITIONAL_OPERATION_FIXED_METHOD_DUPLICATE',
    ]))
  })

  it('rejects invalid, duplicate, and malformed additional operations at exact paths', async () => {
    const longMethod = 'X'.repeat(129)
    const result = await compileOpenAPI({
      openapi: '3.2.0', info: { title: 'invalid', version: '1' },
      paths: { '/mixed': { additionalOperations: {
        '': { responses: { '200': { description: 'ok' } } },
        'bad method': { responses: { '200': { description: 'ok' } } },
        [longMethod]: { responses: { '200': { description: 'ok' } } },
        get: { responses: { '200': { description: 'ok' } } },
        QUERY: { responses: { '200': { description: 'ok' } } },
        BROKEN: 'not-an-operation',
      } } },
    })
    expect(result.success).toBe(false)
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'OPENAPI_ADDITIONAL_OPERATION_METHOD_INVALID', location: expect.objectContaining({ path: ['paths', '/mixed', 'additionalOperations', ''] }) }),
      expect.objectContaining({ code: 'OPENAPI_ADDITIONAL_OPERATION_METHOD_INVALID', location: expect.objectContaining({ path: ['paths', '/mixed', 'additionalOperations', 'bad method'] }) }),
      expect.objectContaining({ code: 'OPENAPI_ADDITIONAL_OPERATION_METHOD_INVALID', location: expect.objectContaining({ path: ['paths', '/mixed', 'additionalOperations', longMethod] }) }),
      expect.objectContaining({ code: 'OPENAPI_ADDITIONAL_OPERATION_FIXED_METHOD_DUPLICATE', location: expect.objectContaining({ path: ['paths', '/mixed', 'additionalOperations', 'get'] }) }),
      expect.objectContaining({ code: 'OPENAPI_ADDITIONAL_OPERATION_FIXED_METHOD_DUPLICATE', location: expect.objectContaining({ path: ['paths', '/mixed', 'additionalOperations', 'QUERY'] }) }),
      expect.objectContaining({ code: 'OPENAPI_VALIDATION_FAILED', location: expect.objectContaining({ path: ['paths', '/mixed', 'additionalOperations', 'BROKEN'] }) }),
    ]))
  })

  it('rejects additionalOperations before OpenAPI 3.2', async () => {
    const result = await compileOpenAPI({
      openapi: '3.1.0', info: { title: 'invalid', version: '1' },
      paths: { '/mixed': { additionalOperations: { FIND: { responses: { '200': { description: 'ok' } } } } } },
    })
    expect(result.success).toBe(false)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'OPENAPI_ADDITIONAL_OPERATIONS_REQUIRES_32',
      location: expect.objectContaining({ path: ['paths', '/mixed', 'additionalOperations'] }),
    }))
  })

  it('rejects multiple content entries for real Parameter and Header objects in compileOpenAPI', async () => {
    const result = await compileOpenAPI({
      openapi: '3.1.0',
      info: { title: 'Cardinality', version: '1' },
      paths: {
        '/items': {
          get: {
            parameters: [{
              name: 'filter',
              in: 'query',
              content: {
                'application/json': { schema: { type: 'object' } },
                'text/plain': { schema: { type: 'string' } },
              },
            }],
            responses: {
              '200': {
                description: 'ok',
                headers: {
                  'X-Filter': {
                    content: {
                      'application/json': { schema: { type: 'object' } },
                      'text/plain': { schema: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        parameters: {
          Multi: {
            name: 'other',
            in: 'query',
            content: { 'application/json': {}, 'text/plain': {} },
          },
        },
        headers: {
          Multi: { content: { 'application/json': {}, 'text/plain': {} } },
        },
        responses: {
          Multi: {
            description: 'component',
            headers: {
              'X-Other': {
                content: { 'application/json': {}, 'text/plain': {} },
              },
            },
          },
        },
      },
    })
    expect(result.success).toBe(false)
    const cardinalityDiagnostics = result.diagnostics.filter(({ code }) => code.includes('CONTENT_CARDINALITY'))
    expect(cardinalityDiagnostics).toHaveLength(5)
    expect(cardinalityDiagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'OPENAPI_HEADER_CONTENT_CARDINALITY',
        severity: 'error',
        location: expect.objectContaining({ path: ['components', 'responses', 'Multi', 'headers', 'X-Other', 'content'] }),
      }),
      expect.objectContaining({
        code: 'OPENAPI_HEADER_CONTENT_CARDINALITY',
        severity: 'error',
        location: expect.objectContaining({ path: ['components', 'headers', 'Multi', 'content'] }),
      }),
      expect.objectContaining({
        code: 'OPENAPI_PARAMETER_CONTENT_CARDINALITY',
        severity: 'error',
        location: expect.objectContaining({ path: ['components', 'parameters', 'Multi', 'content'] }),
      }),
      expect.objectContaining({
        code: 'OPENAPI_HEADER_CONTENT_CARDINALITY',
        severity: 'error',
        location: expect.objectContaining({ path: ['paths', '/items', 'get', 'responses', '200', 'headers', 'X-Filter', 'content'] }),
      }),
      expect.objectContaining({
        code: 'OPENAPI_PARAMETER_CONTENT_CARDINALITY',
        severity: 'error',
        location: expect.objectContaining({ path: ['paths', '/items', 'get', 'parameters', 0, 'content'] }),
      }),
    ]))
  })
})
