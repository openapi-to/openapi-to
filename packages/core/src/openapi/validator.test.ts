import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { compileOpenAPI } from './compiler.ts'

const fixtureRoot = path.dirname(fileURLToPath(import.meta.url))

describe('OpenAPI validator', () => {
  it('recognizes OpenAPI 3.2 in compatibility mode', async () => {
    const result = await compileOpenAPI(path.join(fixtureRoot, 'fixtures/openapi-3.2.yaml'))
    expect(result.success).toBe(true)
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'OPENAPI_32_COMPATIBILITY', severity: 'warning' }), expect.objectContaining({ code: 'OPENAPI_32_FIELD_NOT_GENERATED' })]))
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
