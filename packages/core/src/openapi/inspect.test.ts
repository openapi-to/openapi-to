import { describe, expect, it } from 'vitest'
import type { CompatibleOpenAPIDocument } from '../types/index.ts'
import { inspectOpenAPIDocument } from './inspect.ts'

describe('OpenAPI inspection', () => {
  it('summarizes operations, tags, methods, security, and operationId quality', () => {
    const inspection = inspectOpenAPIDocument({
      openapi: '3.1.0',
      info: { title: 'Inspection', version: '1' },
      paths: {
        '/pets': {
          get: { operationId: 'listPets', tags: ['pets'], deprecated: true, responses: { '200': { description: 'ok' } } },
          post: { tags: ['pets'], responses: { '201': { description: 'created' } } },
        },
      },
      components: { schemas: { Pet: { type: 'object' } }, securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
    } as unknown as CompatibleOpenAPIDocument)
    expect(inspection).toMatchObject({ pathCount: 1, operationCount: 2, schemaCount: 1, securitySchemes: ['bearer'], methodDistribution: { GET: 1, POST: 1 } })
    expect(inspection.tags).toEqual([{ name: 'pets', operations: 2 }])
    expect(inspection.deprecatedOperations).toHaveLength(1)
    expect(inspection.missingOperationIds).toEqual([{ path: '/pets', method: 'POST' }])
  })

  it('preserves exact OpenAPI 3.2 additional method spelling', () => {
    const inspection = inspectOpenAPIDocument({
      openapi: '3.2.0', info: { title: 'Inspection', version: '1' },
      paths: { '/mixed': {
        query: { responses: { '200': { description: 'ok' } } },
        additionalOperations: { FoO: { responses: { '204': { description: 'ok' } } } },
      } },
    } as unknown as CompatibleOpenAPIDocument)
    expect(inspection.methodDistribution).toEqual({ FoO: 1, QUERY: 1 })
    expect(inspection.missingOperationIds).toEqual([
      { path: '/mixed', method: 'FoO' },
      { path: '/mixed', method: 'QUERY' },
    ])
  })

  it('counts prototype-sensitive custom methods as own data properties', () => {
    const source = JSON.parse('{"openapi":"3.2.0","info":{"title":"safe","version":"1"},"paths":{"/safe":{"additionalOperations":{"__proto__":{"operationId":"safeProto","responses":{"200":{"description":"ok"}}}}}}}') as CompatibleOpenAPIDocument
    const inspection = inspectOpenAPIDocument(source)
    expect(inspection.operationCount).toBe(1)
    expect(Object.hasOwn(inspection.methodDistribution, '__proto__')).toBe(true)
    expect(Reflect.get(inspection.methodDistribution, '__proto__')).toBe(1)
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined()
  })
})
