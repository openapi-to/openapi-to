import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { compileOpenAPI } from './compiler.ts'

const fixtureRoot = path.dirname(fileURLToPath(import.meta.url))

describe('OpenAPI validator', () => {
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
