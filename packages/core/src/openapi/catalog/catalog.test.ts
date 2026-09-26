import { describe, expect, it } from 'vitest'

import type { CompatibleOpenAPIDocument } from '../../types/index.ts'
import { buildOperationCatalog } from './builder.ts'
import { getOperationContract } from './contract.ts'
import { searchOperationCatalog, searchOperationCatalogWithMetadata } from './search.ts'

const document = {
  openapi: '3.1.0',
  info: { title: 'Catalog', version: '1' },
  paths: {
    '/users/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      get: {
        operationId: 'getUserResourceTrend',
        tags: ['用户资源'],
        summary: '查询用户资源趋势',
        description: 'Returns the resource trend for one user account.',
        parameters: [{ name: 'include_history', in: 'query', schema: { type: 'boolean' } }],
        responses: {
          '200': {
            description: 'ok',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UserResourceTrendResponse' } } },
          },
          '404': { description: 'not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/users': {
      post: {
        operationId: 'create_user_record',
        tags: ['users'],
        deprecated: true,
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateUserInput' } } } },
        responses: { '201': { description: 'created', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } } },
      },
    },
    '/untagged': { get: { responses: { '204': { description: 'empty' } } } },
    '/duplicate-a': { get: { operationId: 'duplicate', responses: { '200': { description: 'ok' } } } },
    '/duplicate-b': { get: { operationId: 'duplicate', responses: { '200': { description: 'ok' } } } },
  },
  components: {
    schemas: {
      UserResourceTrendResponse: {
        type: 'object',
        required: ['trend'],
        properties: {
          trend: { type: 'array', items: { $ref: '#/components/schemas/TrendPoint' } },
          account_name: { type: 'string' },
          extra: { type: 'string' },
        },
      },
      TrendPoint: {
        type: 'object',
        properties: { timestamp: { type: 'string' }, next: { $ref: '#/components/schemas/TrendPoint' } },
      },
      CreateUserInput: { type: 'object', properties: { displayName: { type: 'string' } } },
      User: { type: 'object', properties: { id: { type: 'string' } } },
      ErrorResponse: { type: 'object', properties: { message: { type: 'string' } } },
    },
  },
} as unknown as CompatibleOpenAPIDocument

describe('Operation Catalog', () => {
  it('assigns stable identities and reports missing and duplicate operationIds without dropping untagged operations', () => {
    const catalog = buildOperationCatalog(document, { target: 'backend' })
    expect(catalog.items).toHaveLength(5)
    expect(catalog.items.find(({ path }) => path === '/users/{id}')?.operationKey).toBe('getUserResourceTrend')
    expect(catalog.items.find(({ path }) => path === '/untagged')).toMatchObject({ operationKey: 'GET /untagged', tags: [] })
    expect(catalog.items.filter(({ operationId }) => operationId === 'duplicate').map(({ operationKey }) => operationKey)).toEqual(['GET /duplicate-a', 'GET /duplicate-b'])
    expect(catalog.diagnostics.map(({ code }) => code)).toEqual(expect.arrayContaining(['MISSING_OPERATION_ID', 'DUPLICATE_OPERATION_ID', 'OPERATION_KEY_FALLBACK_USED']))
  })

  it('searches exact ids and keys, method/path, fragments, tags, schemas, parameters, Chinese, and split identifiers', () => {
    const catalog = buildOperationCatalog(document)
    expect(searchOperationCatalog(catalog, 'getUserResourceTrend')[0]?.item.operationKey).toBe('getUserResourceTrend')
    expect(searchOperationCatalog(catalog, 'GET /untagged')[0]?.item.operationKey).toBe('GET /untagged')
    expect(searchOperationCatalog(catalog, 'GET /users/{id}')[0]?.item.operationKey).toBe('getUserResourceTrend')
    expect(searchOperationCatalog(catalog, 'users id')[0]?.item.operationKey).toBe('getUserResourceTrend')
    expect(searchOperationCatalog(catalog, '用户资源')[0]?.item.operationKey).toBe('getUserResourceTrend')
    expect(searchOperationCatalog(catalog, 'UserResourceTrendResponse')[0]?.item.operationKey).toBe('getUserResourceTrend')
    expect(searchOperationCatalog(catalog, 'include history')[0]?.item.operationKey).toBe('getUserResourceTrend')
    expect(searchOperationCatalog(catalog, '查询用户资源趋势')[0]?.item.operationKey).toBe('getUserResourceTrend')
    expect(searchOperationCatalog(catalog, 'create user', { includeDeprecated: true })[0]?.item.operationKey).toBe('create_user_record')
  })

  it('discovers exact bare paths without similar-path collisions and preserves explicit method evidence', () => {
    const petDocument = {
      openapi: '3.1.0',
      info: { title: 'Pet API', version: '1' },
      paths: {
        '/pet/findByStatus': {
          get: { operationId: 'findPetsByStatus', responses: { '200': { description: 'ok' } } },
          post: { operationId: 'searchPetsByStatus', responses: { '200': { description: 'ok' } } },
        },
        '/pet/findByTags': {
          get: { operationId: 'findPetsByTags', responses: { '200': { description: 'ok' } } },
        },
        '/pet/{petId}': {
          get: { operationId: 'getPetById', responses: { '200': { description: 'ok' } } },
        },
      },
    } as unknown as CompatibleOpenAPIDocument
    const catalog = buildOperationCatalog(petDocument)

    const barePath = searchOperationCatalogWithMetadata(catalog, '/pet/findByStatus')
    const repeatedBarePath = searchOperationCatalogWithMetadata(catalog, '/pet/findByStatus')
    expect(barePath).toEqual(repeatedBarePath)
    expect(barePath.items.map(({ item }) => [item.method, item.path])).toEqual([
      ['GET', '/pet/findByStatus'],
      ['POST', '/pet/findByStatus'],
    ])
    expect(barePath.items.every(({ matchReasons }) => matchReasons.includes('path exact match'))).toBe(true)
    expect(barePath.items.some(({ item }) => item.path === '/pet/findByTags' || item.path === '/pet/{petId}')).toBe(false)

    const methodPath = searchOperationCatalogWithMetadata(catalog, 'GET /pet/findByStatus')
    expect(methodPath.items[0]).toMatchObject({
      item: { method: 'GET', path: '/pet/findByStatus' },
      matchReasons: expect.arrayContaining(['method and path exact match']),
    })
    expect(methodPath.items.some(({ item }) => item.method !== 'GET' || item.path !== '/pet/findByStatus')).toBe(false)
    expect(searchOperationCatalog(catalog, '/dashboard/settings')).toEqual([])
  })

  it('applies stable sorting, limits, filters, and deprecated policy', () => {
    const catalog = buildOperationCatalog(document)
    const first = searchOperationCatalog(catalog, 'duplicate', { limit: 1 })
    const second = searchOperationCatalog(catalog, 'duplicate', { limit: 1 })
    expect(first).toEqual(second)
    expect(first).toHaveLength(1)
    expect(searchOperationCatalog(catalog, 'user', { methods: ['POST'] })).toEqual([])
    expect(searchOperationCatalog(catalog, 'user', { methods: ['POST'], includeDeprecated: true })).toHaveLength(1)
    expect(searchOperationCatalog(catalog, 'user', { tags: ['用户资源'] })).toHaveLength(1)
  })

  it('returns bounded contracts, success and error responses, cycles, and explicit truncation', () => {
    const catalog = buildOperationCatalog(document)
    const result = getOperationContract(catalog, 'getUserResourceTrend', { schemaDepth: 1, maxSchemas: 1, maxPropertiesPerSchema: 2 })
    expect(result.found).toBe(true)
    expect(result.operation?.parameters?.path.map(({ name }) => name)).toEqual(['id'])
    expect(result.operation?.parameters?.query.map(({ name }) => name)).toEqual(['include_history'])
    expect(result.operation?.responses?.map(({ status, success }) => ({ status, success }))).toEqual([
      { status: '200', success: true },
      { status: '404', success: false },
    ])
    expect(result.operation?.schemas).toHaveLength(1)
    expect(result.operation?.schemas?.[0]?.properties).toHaveLength(2)
    expect(result.truncated).toBe(true)
    expect(result.truncationReasons).toEqual(expect.arrayContaining(['maxSchemas', 'maxPropertiesPerSchema']))
    const schemaLimited = getOperationContract(catalog, 'getUserResourceTrend', { schemaDepth: 10, maxSchemas: 1, maxPropertiesPerSchema: 3 })
    expect(schemaLimited.operation?.schemas?.[0]?.properties?.find(({ name }) => name === 'trend')?.schema.items).toEqual(expect.objectContaining({ name: 'TrendPoint' }))
    expect(schemaLimited.operation?.schemas?.[0]?.properties?.find(({ name }) => name === 'trend')?.schema.items?.properties).toBeUndefined()
    expect(getOperationContract(catalog, 'getUserResourceTrend', { schemaDepth: 0, maxSchemas: 1, maxPropertiesPerSchema: 3 }).truncationReasons).toContain('schemaDepth')
  })

  it('terminates circular schemas, enforces byte limits, and isolates targets', () => {
    const backend = buildOperationCatalog(document, { target: 'backend' })
    const otherDocument = { ...document, paths: { '/users/{id}': { get: { operationId: 'otherGet', responses: { '200': { description: 'ok' } } } } } } as unknown as CompatibleOpenAPIDocument
    const admin = buildOperationCatalog(otherDocument, { target: 'admin' })
    expect(backend.items[0]?.target).toBe('backend')
    expect(admin.items).toEqual([expect.objectContaining({ target: 'admin', operationKey: 'otherGet' })])
    expect(JSON.stringify(getOperationContract(backend, 'getUserResourceTrend', { schemaDepth: 10, maxSchemas: 20, maxPropertiesPerSchema: 10 }).operation?.schemas)).toContain('"circular":true')
    expect(getOperationContract(backend, 'getUserResourceTrend', { maxBytes: 1_024 }).byteLength).toBeLessThanOrEqual(1_024)
    expect(getOperationContract(backend, 'missing').diagnostics).toEqual([expect.objectContaining({ code: 'OPERATION_NOT_FOUND' })])
  })
})
