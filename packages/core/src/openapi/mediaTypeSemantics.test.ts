import { describe, expect, it } from 'vitest'
import { classifyOpenAPI32EncodingContentTypes, classifyOpenAPI32MediaType } from './mediaTypeSemantics.ts'

describe('OpenAPI 3.2 media semantics', () => {
  it.each([
    ['application/jsonl', 'sequential-json'], ['application/json-seq; charset=utf-8', 'sequential-json'],
    ['application/x-ndjson', 'sequential-json'], ['APPLICATION/VND.EXAMPLE+JSON-SEQ', 'sequential-json'],
    ['text/event-stream; charset=utf-8', 'sse'], ['multipart/form-data; boundary=abc', 'multipart'],
    ['multipart/mixed', 'multipart'], ['multipart/related; type="text/html"', 'multipart'],
    ['multipart/byteranges', 'multipart'], ['application/x-www-form-urlencoded', 'form-urlencoded'],
    ['application/json', 'other'], ['application/vnd.example+json', 'other'],
    ['text/plain', 'other'], ['application/octet-stream', 'other'], ['application/x-custom', 'other'],
  ] as const)('%s is %s', (source, family) => {
    const result = classifyOpenAPI32MediaType(source, {})
    expect(result.family).toBe(family)
    expect(result.sourceMediaType).toBe(source)
    expect(result.normalizedMediaType).toBe(source.split(';')[0]?.toLowerCase())
  })

  it('preserves independent complete and item schemas, including custom media', () => {
    const schema = { type: 'array' }
    const itemSchema = { $ref: '#/components/schemas/Event' }
    for (const value of [{}, { schema }, { itemSchema }, { schema, itemSchema }]) {
      const result = classifyOpenAPI32MediaType('application/x-custom', value)
      expect(result.hasSchema).toBe(Object.hasOwn(value, 'schema'))
      expect(result.hasItemSchema).toBe(Object.hasOwn(value, 'itemSchema'))
      expect(result.schema).toBe(value.schema)
      expect(result.itemSchema).toBe(value.itemSchema)
    }
  })

  it('ignores Media Type Reference Object siblings without changing Schema Object references', () => {
    const schema = { $ref: '#/components/schemas/Event', type: 'object' }
    const reference = classifyOpenAPI32MediaType('multipart/mixed', {
      $ref: '#/components/mediaTypes/Shared', summary: 'Shared media', description: 'Reusable',
      schema, itemSchema: schema, encoding: {}, prefixEncoding: [{}], itemEncoding: {},
    })
    expect(reference).toMatchObject({
      objectKind: 'reference', hasSchema: false, hasItemSchema: false,
      encodingState: 'absent', prefixEncodingState: 'absent', itemEncodingState: 'absent',
      encodingMode: 'none', hasEncodingConflict: false,
    })
    expect(reference.schema).toBeUndefined()
    expect(reference.itemSchema).toBeUndefined()
    expect(classifyOpenAPI32MediaType('application/json', { schema, itemSchema: schema })).toMatchObject({
      objectKind: 'media-type', schema, itemSchema: schema, hasSchema: true, hasItemSchema: true,
    })
  })

  it('distinguishes by-name, positional, and ignored fields', () => {
    expect(classifyOpenAPI32MediaType('multipart/related; type="application/json"', { encoding: {} }).encodingMode).toBe('by-name')
    expect(classifyOpenAPI32MediaType('multipart/mixed', { prefixEncoding: [], itemEncoding: {} })).toMatchObject({ encodingMode: 'positional', prefixEncodingState: 'active', itemEncodingState: 'active', hasEncodingConflict: false })
    expect(classifyOpenAPI32MediaType('application/x-www-form-urlencoded', { encoding: {}, prefixEncoding: [] })).toMatchObject({ encodingState: 'active', prefixEncodingState: 'ignored', hasEncodingConflict: true })
    expect(classifyOpenAPI32MediaType('application/json', { encoding: {}, prefixEncoding: [], itemEncoding: {} })).toMatchObject({ encodingState: 'ignored', prefixEncodingState: 'ignored', itemEncodingState: 'ignored' })
  })

  it('classifies each Encoding contentType candidate without splitting quoted parameters', () => {
    expect(classifyOpenAPI32EncodingContentTypes('multipart/mixed; name="a,b", application/json', { itemEncoding: {} }).map(({ family, itemEncodingState }) => [family, itemEncodingState])).toEqual([
      ['multipart', 'active'], ['other', 'ignored'],
    ])
  })
})
