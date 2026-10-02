import { describe, expect, it } from 'vitest'

import type { CompatibleOpenAPIDocument } from '../types/index.ts'
import { enumerateOpenAPIOperations } from './operations.ts'

function document(version: string): CompatibleOpenAPIDocument {
  return {
    openapi: version,
    info: { title: 'Operations', version: '1' },
    paths: {
      '/mixed': {
        get: { operationId: 'getMixed', responses: { '200': { description: 'ok' } } },
        query: { operationId: 'queryMixed', responses: { '200': { description: 'ok' } } },
        additionalOperations: {
          FIND: { operationId: 'findMixed', responses: { '200': { description: 'ok' } } },
          FoO: { operationId: 'fooMixed', responses: { '200': { description: 'ok' } } },
        },
      },
    },
  } as unknown as CompatibleOpenAPIDocument
}

describe('enumerateOpenAPIOperations', () => {
  it('enumerates OpenAPI 3.2 fixed and additional operations with exact identities', () => {
    expect(enumerateOpenAPIOperations(document('3.2.0')).map(({ sourceKind, sourceMethod, wireMethod, method, operationKind, sourcePointer }) => ({
      sourceKind, sourceMethod, wireMethod, method, operationKind, sourcePointer,
    }))).toEqual([
      { sourceKind: 'fixed', sourceMethod: 'get', wireMethod: 'GET', method: 'get', operationKind: 'query', sourcePointer: '/paths/~1mixed/get' },
      { sourceKind: 'fixed', sourceMethod: 'query', wireMethod: 'QUERY', method: 'query', operationKind: 'query', sourcePointer: '/paths/~1mixed/query' },
      { sourceKind: 'additional', sourceMethod: 'FIND', wireMethod: 'FIND', method: 'FIND', operationKind: 'unknown', sourcePointer: '/paths/~1mixed/additionalOperations/FIND' },
      { sourceKind: 'additional', sourceMethod: 'FoO', wireMethod: 'FoO', method: 'FoO', operationKind: 'unknown', sourcePointer: '/paths/~1mixed/additionalOperations/FoO' },
    ])
  })

  it('does not promote OpenAPI 3.2-only slots in earlier dialects', () => {
    expect(enumerateOpenAPIOperations(document('3.1.0')).map(({ sourceMethod }) => sourceMethod)).toEqual(['get'])
  })

  it('preserves prototype-sensitive custom method keys as data', () => {
    const source = JSON.parse('{"openapi":"3.2.0","info":{"title":"safe","version":"1"},"paths":{"/safe":{"additionalOperations":{"__proto__":{"operationId":"safeProto","responses":{"200":{"description":"ok"}}}}}}}') as CompatibleOpenAPIDocument
    expect(enumerateOpenAPIOperations(source).map(({ sourceMethod, wireMethod, sourcePointer }) => ({ sourceMethod, wireMethod, sourcePointer }))).toEqual([
      { sourceMethod: '__proto__', wireMethod: '__proto__', sourcePointer: '/paths/~1safe/additionalOperations/__proto__' },
    ])
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined()
  })
})
