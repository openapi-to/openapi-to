/** OpenAPI 3.2 Media Type Object semantics. This does not imply a transport codec. */
export type MediaFamily = 'sequential-json' | 'sse' | 'multipart' | 'form-urlencoded' | 'other'
export type MediaFieldState = 'absent' | 'active' | 'ignored'

/** A structural path to a Media Type Object | Reference Object union entry. */
export function isMediaTypeReferencePosition(path: Array<string | number>): boolean {
  const content = (index: number) => path[index] === 'content' && path.length === index + 2
  const response = (index: number) => content(index) || (path[index] === 'headers' && content(index + 2))
  const operation = (index: number): boolean => {
    if (path[index] === 'requestBody') return content(index + 1)
    if (path[index] === 'responses') return response(index + 2)
    if (path[index] === 'parameters') return content(index + 2)
    if (path[index] === 'callbacks') return pathItem(index + 3)
    return false
  }
  const pathItem = (index: number): boolean => {
    if (path[index] === 'parameters') return content(index + 2)
    if (path[index] === 'additionalOperations') return operation(index + 2)
    if (['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace', 'query'].includes(String(path[index]))) return operation(index + 1)
    return false
  }
  if (path[0] === 'components') {
    if (path[1] === 'mediaTypes') return path.length === 3
    if (['requestBodies', 'parameters', 'headers'].includes(String(path[1]))) return content(3)
    if (path[1] === 'responses') return response(3)
    if (path[1] === 'callbacks') return pathItem(4)
    if (path[1] === 'pathItems') return pathItem(3)
    return false
  }
  if (path[0] === 'paths' || path[0] === 'webhooks') return pathItem(2)
  return operation(0)
}

export interface OpenAPI32MediaTypeSemantics {
  objectKind: 'media-type' | 'reference'
  sourceMediaType: string
  normalizedMediaType: string
  family: MediaFamily
  schema: unknown
  itemSchema: unknown
  hasSchema: boolean
  hasItemSchema: boolean
  encoding: unknown
  prefixEncoding: unknown
  itemEncoding: unknown
  encodingState: MediaFieldState
  prefixEncodingState: MediaFieldState
  itemEncodingState: MediaFieldState
  encodingMode: 'none' | 'by-name' | 'positional' | 'ignored'
  hasEncodingConflict: boolean
}

export function normalizeMediaType(mediaType: string): string {
  return mediaType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
}

/** Encoding Object contentType is a comma-separated list of media ranges. */
export function classifyOpenAPI32EncodingContentTypes(contentType: string, mediaTypeObject: object): OpenAPI32MediaTypeSemantics[] {
  const candidates: string[] = []
  let start = 0
  let quoted = false
  let escaped = false
  for (let index = 0; index < contentType.length; index += 1) {
    const character = contentType[index]
    if (escaped) escaped = false
    else if (character === '\\' && quoted) escaped = true
    else if (character === '"') quoted = !quoted
    else if (character === ',' && !quoted) {
      candidates.push(contentType.slice(start, index).trim())
      start = index + 1
    }
  }
  candidates.push(contentType.slice(start).trim())
  return candidates.filter(Boolean).map((candidate) => classifyMediaFields(candidate, mediaTypeObject, false))
}

export function classifyOpenAPI32MediaType(sourceMediaType: string, mediaTypeObject: object): OpenAPI32MediaTypeSemantics {
  return classifyMediaFields(sourceMediaType, mediaTypeObject, true)
}

function classifyMediaFields(sourceMediaType: string, mediaTypeObject: object, referenceAllowed: boolean): OpenAPI32MediaTypeSemantics {
  const value = mediaTypeObject as Record<string, unknown>
  const normalizedMediaType = normalizeMediaType(sourceMediaType)
  const family: MediaFamily = normalizedMediaType.startsWith('multipart/')
    ? 'multipart'
    : normalizedMediaType === 'application/x-www-form-urlencoded'
      ? 'form-urlencoded'
      : normalizedMediaType === 'text/event-stream'
        ? 'sse'
        : normalizedMediaType === 'application/jsonl' || normalizedMediaType === 'application/json-seq' || normalizedMediaType === 'application/x-ndjson' || /^[^/]+\/[^/]+\+json-seq$/.test(normalizedMediaType)
          ? 'sequential-json'
          : 'other'
  // Only the Media Type Object | Reference Object union has Reference Object semantics.
  // Encoding Objects may contain extension fields and are classified separately.
  if (referenceAllowed && typeof value.$ref === 'string') return {
    objectKind: 'reference', sourceMediaType, normalizedMediaType, family,
    schema: undefined, itemSchema: undefined, hasSchema: false, hasItemSchema: false,
    encoding: undefined, prefixEncoding: undefined, itemEncoding: undefined,
    encodingState: 'absent', prefixEncodingState: 'absent', itemEncodingState: 'absent',
    encodingMode: 'none', hasEncodingConflict: false,
  }
  const hasEncoding = Object.hasOwn(value, 'encoding')
  const hasPrefix = Object.hasOwn(value, 'prefixEncoding')
  const hasItem = Object.hasOwn(value, 'itemEncoding')
  const encodingState: MediaFieldState = !hasEncoding ? 'absent' : family === 'multipart' || family === 'form-urlencoded' ? 'active' : 'ignored'
  const prefixEncodingState: MediaFieldState = !hasPrefix ? 'absent' : family === 'multipart' ? 'active' : 'ignored'
  const itemEncodingState: MediaFieldState = !hasItem ? 'absent' : family === 'multipart' ? 'active' : 'ignored'
  const encodingMode = encodingState === 'active' ? 'by-name'
    : prefixEncodingState === 'active' || itemEncodingState === 'active' ? 'positional'
      : hasEncoding || hasPrefix || hasItem ? 'ignored' : 'none'
  return {
    objectKind: 'media-type', sourceMediaType, normalizedMediaType, family,
    schema: value.schema, itemSchema: value.itemSchema,
    hasSchema: Object.hasOwn(value, 'schema'), hasItemSchema: Object.hasOwn(value, 'itemSchema'),
    encoding: value.encoding, prefixEncoding: value.prefixEncoding, itemEncoding: value.itemEncoding,
    encodingState, prefixEncodingState, itemEncodingState, encodingMode,
    hasEncodingConflict: hasEncoding && (hasPrefix || hasItem),
  }
}
