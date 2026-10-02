import { describe, expect, it } from 'vitest'
import type { CompatibleOpenAPIDocument } from '../types'
import { diffOpenAPIDocuments } from './index.ts'

const base = {
  openapi: '3.1.0', info: { title: 'API', version: '1' },
  paths: { '/pets': { get: { operationId: 'listPets', responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'array' } } } } } } } },
  components: { schemas: { Pet: { type: 'object', required: ['id'], properties: { id: { type: 'integer' }, status: { type: 'string', enum: ['ok', 'bad'] } } } } },
}

describe('OpenAPI diff', () => {
  it('classifies contract changes deterministically', () => {
    const after = structuredClone(base)
    const afterPaths = after.paths as Record<string, { get?: unknown }>
    const pets = afterPaths['/pets']
    if (pets) delete pets.get
    afterPaths['/owners'] = { get: { operationId: 'owners', responses: { '200': { description: 'ok' } } } }
    after.components.schemas.Pet.properties.status.enum = ['ok', 'new']
    const result = diffOpenAPIDocuments(base as unknown as CompatibleOpenAPIDocument, after as unknown as CompatibleOpenAPIDocument)
    expect(result.breaking).toBe(true)
    expect(result.changes.map((change) => change.code)).toEqual(expect.arrayContaining(['OPERATION_REMOVED', 'PATH_ADDED', 'SCHEMA_ENUM_VALUE_REMOVED', 'SCHEMA_ENUM_VALUE_ADDED']))
    expect(result.summary.breaking).toBeGreaterThan(0)
  })

  it('treats additional operation casing as wire-significant identity', () => {
    const before = {
      openapi: '3.2.0', info: { title: 'API', version: '1' },
      paths: { '/pets': { additionalOperations: { FoO: { operationId: 'custom', responses: { '200': { description: 'ok' } } } } } },
    } as unknown as CompatibleOpenAPIDocument
    const after = structuredClone(before) as unknown as CompatibleOpenAPIDocument
    const pathItem = (after.paths as Record<string, Record<string, unknown>>)['/pets']
    if (!pathItem) throw new TypeError('Expected path item')
    pathItem.additionalOperations = { FOO: { operationId: 'custom', responses: { '200': { description: 'ok' } } } }
    const result = diffOpenAPIDocuments(before, after)
    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'OPERATION_REMOVED', path: ['paths', '/pets', 'additionalOperations', 'FoO'] }),
      expect.objectContaining({ code: 'OPERATION_ADDED', path: ['paths', '/pets', 'additionalOperations', 'FOO'] }),
    ]))
  })
})
