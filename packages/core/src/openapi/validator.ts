import { type Diagnostic, sortDiagnostics } from '../diagnostics.ts'
import { type OpenapiExecutionOptions, throwIfAborted } from '../execution.ts'
import type { CompatibleOpenAPIDocument } from '../types'
import { effectiveParameters } from './effectiveParameters.ts'
import { FIXED_OPERATION_METHODS } from './operations.ts'
import { classifyOpenAPI32EncodingContentTypes, classifyOpenAPI32MediaType, normalizeMediaType } from './mediaTypeSemantics.ts'

const operationMethods = FIXED_OPERATION_METHODS
const httpMethodToken = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function add32MetadataDiagnostics(document: Record<string, unknown>, source: string, diagnostics: Diagnostic[], options: OpenapiExecutionOptions): void {
  const opaqueExamplePayloadFields = new Set(['example', 'dataValue', 'value', 'serializedValue', 'default', 'const', 'enum', 'schema', 'schemas', 'itemSchema', 'links'])
  const self = document.$self
  if (Object.hasOwn(document, '$self')) {
    if (typeof self !== 'string') {
      diagnostics.push({ code: 'OPENAPI_32_SELF_INVALID', severity: 'error', message: 'OpenAPI 3.2 $self must be a URI reference.', location: { source, path: ['$self'] } })
    } else {
      try {
        // A fixed absolute retrieval URI lets URL validate both absolute and relative references.
        if (/[^\x21-\x7e]|["<>\\^`{|}]|%(?![0-9a-fA-F]{2})/.test(self)) throw new TypeError('Invalid URI reference characters.')
        new URL(self, 'https://openapi-to.invalid/openapi.json')
      } catch {
        diagnostics.push({ code: 'OPENAPI_32_SELF_INVALID', severity: 'error', message: 'OpenAPI 3.2 $self must be a URI reference.', location: { source, path: ['$self'] } })
      }
    }
  }

  if (document.tags !== undefined && !Array.isArray(document.tags)) {
    diagnostics.push({ code: 'OPENAPI_32_TAGS_INVALID', severity: 'error', message: 'OpenAPI 3.2 tags must be an array of Tag Objects.', location: { source, path: ['tags'] } })
  }
  const declaredTags = Array.isArray(document.tags) ? document.tags : []
  const tagsByName = new Map<string, { index: number; value: Record<string, unknown> }>()
  for (let index = 0; index < declaredTags.length; index += 1) {
    throwIfAborted(options.signal)
    const tag = declaredTags[index]
    if (!isRecord(tag)) {
      diagnostics.push({ code: 'OPENAPI_32_TAG_INVALID', severity: 'error', message: 'Each OpenAPI 3.2 tag must be a Tag Object.', location: { source, path: ['tags', index] } })
      continue
    }
    if (typeof tag.name !== 'string') {
      diagnostics.push({ code: 'OPENAPI_32_TAG_NAME_REQUIRED', severity: 'error', message: 'Each OpenAPI 3.2 Tag Object requires a string name.', location: { source, path: ['tags', index, 'name'] } })
      continue
    }
    const previous = tagsByName.get(tag.name)
    if (previous) {
      diagnostics.push({ code: 'OPENAPI_32_TAG_NAME_DUPLICATE', severity: 'error', message: 'OpenAPI 3.2 tag names must be unique.', location: { source, path: ['tags', index, 'name'] }, hint: `First declared at tags.${previous.index}.name.` })
      continue
    }
    tagsByName.set(tag.name, { index, value: tag })
  }
  for (const entry of tagsByName.values()) {
    throwIfAborted(options.signal)
    if (Object.hasOwn(entry.value, 'parent') && typeof entry.value.parent !== 'string') {
      diagnostics.push({ code: 'OPENAPI_32_TAG_PARENT_INVALID', severity: 'error', message: 'A Tag Object parent must be a string.', location: { source, path: ['tags', entry.index, 'parent'] } })
    } else if (typeof entry.value.parent === 'string' && !tagsByName.has(entry.value.parent)) {
      diagnostics.push({ code: 'OPENAPI_32_TAG_PARENT_NOT_FOUND', severity: 'error', message: 'The declared parent tag does not exist.', location: { source, path: ['tags', entry.index, 'parent'] } })
    }
  }

  // Tag hierarchy is a functional graph (each tag has at most one parent). Walk
  // iteratively so malformed, deeply nested input remains bounded by tag count.
  const completed = new Set<string>()
  for (const start of [...tagsByName.keys()].sort(compareText)) {
    if (completed.has(start)) continue
    const chain: string[] = []
    const positions = new Map<string, number>()
    let current: string | undefined = start
    while (current !== undefined && tagsByName.has(current) && !completed.has(current)) {
      throwIfAborted(options.signal)
      const repeatedAt = positions.get(current)
      if (repeatedAt !== undefined) {
        const closingName = chain.at(-1)
        const closingTag = closingName === undefined ? undefined : tagsByName.get(closingName)
        if (closingTag && typeof closingTag.value.parent === 'string') {
          diagnostics.push({ code: 'OPENAPI_32_TAG_PARENT_CYCLE', severity: 'error', message: 'Tag parent references must not form a cycle.', location: { source, path: ['tags', closingTag.index, 'parent'] } })
        }
        break
      }
      positions.set(current, chain.length)
      chain.push(current)
      const parent: unknown = tagsByName.get(current)?.value.parent
      current = typeof parent === 'string' && tagsByName.has(parent) ? parent : undefined
    }
    for (const name of chain) completed.add(name)
  }

  const visitExamples = (value: unknown, path: Array<string | number>): void => {
    throwIfAborted(options.signal)
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        visitExamples(item, [...path, index])
      })
      return
    }
    if (!isRecord(value)) return
    for (const key of Object.keys(value).sort(compareText)) {
      const child = value[key]
      const childPath = [...path, key]
      if (key === 'examples') {
        // OpenAPI Example maps are objects; JSON Schema `examples` arrays and
        // all example payloads are data, so never recurse into either shape.
        if (isRecord(child)) {
          for (const exampleName of Object.keys(child).sort(compareText)) {
            const example = child[exampleName]
            if (!isRecord(example)) continue
            const examplePath = [...childPath, exampleName]
            const conflicts: Array<{ field: string; other: string }> = []
            if (Object.hasOwn(example, 'dataValue') && Object.hasOwn(example, 'value')) conflicts.push({ field: 'value', other: 'dataValue' })
            if (Object.hasOwn(example, 'serializedValue')) {
              if (Object.hasOwn(example, 'value')) conflicts.push({ field: 'value', other: 'serializedValue' })
              if (Object.hasOwn(example, 'externalValue')) conflicts.push({ field: 'externalValue', other: 'serializedValue' })
            }
            if (Object.hasOwn(example, 'externalValue') && Object.hasOwn(example, 'value')) conflicts.push({ field: 'value', other: 'externalValue' })
            for (const { field, other } of conflicts.sort((left, right) => compareText(left.field, right.field) || compareText(left.other, right.other))) diagnostics.push({
              code: 'OPENAPI_32_EXAMPLE_FIELD_CONFLICT', severity: 'error',
              message: `Example Object fields ${field} and ${other} are mutually exclusive.`,
              location: { source, path: [...examplePath, field] },
            })
          }
        }
        continue
      }
      // These fields carry arbitrary payloads, JSON Schema vocabulary, or Link
      // Objects whose parameters and requestBody values are Any data.
      if (key.startsWith('x-') || opaqueExamplePayloadFields.has(key)) continue
      visitExamples(child, childPath)
    }
  }
  visitExamples(document, [])
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function add32MediaDiagnostics(document: Record<string, unknown>, source: string, diagnostics: Diagnostic[], options: OpenapiExecutionOptions): void {
  const ignored = new Set<string>()
  const visitedReusableMedia = new Set<string>()
  const conflict = (path: Array<string | number>, field: string) => diagnostics.push({
    code: 'OPENAPI_32_ENCODING_CONFLICT', severity: 'error',
    message: 'By-name encoding and positional encoding MUST NOT coexist in a Media Type Object.',
    location: { source, path: [...path, field] },
  })
  const visitEncoding = (value: unknown, path: Array<string | number>, depth: number, seen: WeakSet<object>) => {
    throwIfAborted(options.signal)
    if (!isRecord(value) || seen.has(value) || depth > 16) return
    seen.add(value)
    // A nested Encoding Object supplies the media type of its own value.
    const candidates = typeof value.contentType === 'string' ? classifyOpenAPI32EncodingContentTypes(value.contentType, value) : []
    if (candidates.length > 0) {
      for (const field of ['encoding', 'prefixEncoding', 'itemEncoding'] as const) {
        const states = candidates.map((candidate) => field === 'encoding' ? candidate.encodingState : field === 'prefixEncoding' ? candidate.prefixEncodingState : candidate.itemEncodingState)
        if (states.every((state) => state !== 'active')) {
          ignored.add(JSON.stringify([...path, field]))
        }
      }
      if (candidates.some((candidate) => candidate.hasEncodingConflict && (candidate.encodingState === 'active' || candidate.prefixEncodingState === 'active' || candidate.itemEncodingState === 'active'))) {
        if (Object.hasOwn(value, 'prefixEncoding')) conflict(path, 'prefixEncoding')
        if (Object.hasOwn(value, 'itemEncoding')) conflict(path, 'itemEncoding')
      }
    }
    if (!ignored.has(JSON.stringify([...path, 'encoding'])) && isRecord(value.encoding)) for (const key of Object.keys(value.encoding).sort(compareText)) visitEncoding(value.encoding[key], [...path, 'encoding', key], depth + 1, seen)
    if (!ignored.has(JSON.stringify([...path, 'prefixEncoding'])) && Array.isArray(value.prefixEncoding)) value.prefixEncoding.forEach((item, index) => { visitEncoding(item, [...path, 'prefixEncoding', index], depth + 1, seen) })
    if (!ignored.has(JSON.stringify([...path, 'itemEncoding']))) visitEncoding(value.itemEncoding, [...path, 'itemEncoding'], depth + 1, seen)
  }
  const content = (value: unknown, path: Array<string | number>) => {
    if (!isRecord(value)) return
    for (const mediaType of Object.keys(value).sort(compareText)) {
      const media = value[mediaType]
      if (!isRecord(media)) continue
      const mediaPath = [...path, mediaType]
      const mediaTypes = isRecord(document.components) && isRecord(document.components.mediaTypes) ? document.components.mediaTypes : undefined
      let referenced: Record<string, unknown> | undefined = media
      let name: string | undefined
      const seenReferences = new Set<string>()
      while (typeof referenced?.$ref === 'string') {
        const reference: string = referenced.$ref
        if (!reference.startsWith('#/components/mediaTypes/')) break
        const nextName: string = reference.slice('#/components/mediaTypes/'.length).replaceAll('~1', '/').replaceAll('~0', '~')
        if (seenReferences.has(nextName)) break
        seenReferences.add(nextName)
        const next: unknown = mediaTypes?.[nextName]
        if (!isRecord(next)) break
        name = nextName
        referenced = next
      }
      if (name !== undefined && isRecord(referenced) && typeof referenced.$ref !== 'string') {
        const visitKey = JSON.stringify([name, normalizeMediaType(mediaType)])
        if (!visitedReusableMedia.has(visitKey)) {
          visitedReusableMedia.add(visitKey)
          const componentPath = ['components', 'mediaTypes', name]
          const reusableSemantics = classifyOpenAPI32MediaType(mediaType, referenced)
          for (const field of ['itemSchema', 'encoding', 'prefixEncoding', 'itemEncoding'] as const) {
            if (!Object.hasOwn(referenced, field)) continue
            const fieldPath = [...componentPath, field]
            const state = field === 'encoding' ? reusableSemantics.encodingState : field === 'prefixEncoding' ? reusableSemantics.prefixEncodingState : field === 'itemEncoding' ? reusableSemantics.itemEncodingState : 'active'
            if (state === 'ignored') ignored.add(JSON.stringify(fieldPath))
          }
          const seen = new WeakSet<object>()
          if (reusableSemantics.encodingState === 'active' && isRecord(referenced.encoding)) for (const key of Object.keys(referenced.encoding).sort(compareText)) visitEncoding(referenced.encoding[key], [...componentPath, 'encoding', key], 0, seen)
          if (reusableSemantics.prefixEncodingState === 'active' && Array.isArray(referenced.prefixEncoding)) referenced.prefixEncoding.forEach((item, index) => { visitEncoding(item, [...componentPath, 'prefixEncoding', index], 0, seen) })
          if (reusableSemantics.itemEncodingState === 'active') visitEncoding(referenced.itemEncoding, [...componentPath, 'itemEncoding'], 0, seen)
        }
      }
      if (typeof media.$ref === 'string') {
        ignored.add(JSON.stringify(mediaPath))
        continue
      }
      const semantics = classifyOpenAPI32MediaType(mediaType, media)
      for (const field of ['itemSchema', 'encoding', 'prefixEncoding', 'itemEncoding'] as const) {
        if (!Object.hasOwn(media, field)) continue
        const fieldPath = [...mediaPath, field]
        const state = field === 'encoding' ? semantics.encodingState : field === 'prefixEncoding' ? semantics.prefixEncodingState : field === 'itemEncoding' ? semantics.itemEncodingState : 'active'
        if (state === 'ignored') ignored.add(JSON.stringify(fieldPath))
      }
      if (semantics.hasEncodingConflict) {
        if (Object.hasOwn(media, 'prefixEncoding')) conflict(mediaPath, 'prefixEncoding')
        if (Object.hasOwn(media, 'itemEncoding')) conflict(mediaPath, 'itemEncoding')
      }
      const seen = new WeakSet<object>()
      if (semantics.encodingState === 'active' && isRecord(media.encoding)) for (const key of Object.keys(media.encoding).sort(compareText)) visitEncoding(media.encoding[key], [...mediaPath, 'encoding', key], 0, seen)
      if (semantics.prefixEncodingState === 'active' && Array.isArray(media.prefixEncoding)) media.prefixEncoding.forEach((item, index) => { visitEncoding(item, [...mediaPath, 'prefixEncoding', index], 0, seen) })
      if (semantics.itemEncodingState === 'active') visitEncoding(media.itemEncoding, [...mediaPath, 'itemEncoding'], 0, seen)
    }
  }
  const mediaObject = (value: unknown, path: Array<string | number>) => {
    if (isRecord(value)) content(value.content, [...path, 'content'])
  }
  const response = (value: unknown, path: Array<string | number>) => {
    mediaObject(value, path)
    if (isRecord(value) && isRecord(value.headers)) for (const key of Object.keys(value.headers).sort(compareText)) mediaObject(value.headers[key], [...path, 'headers', key])
  }
  const visitedPathItems = new WeakSet<object>()
  function operation(value: unknown, path: Array<string | number>, depth: number): void {
    if (!isRecord(value)) return
    mediaObject(value.requestBody, [...path, 'requestBody'])
    if (isRecord(value.responses)) for (const key of Object.keys(value.responses).sort(compareText)) response(value.responses[key], [...path, 'responses', key])
    if (Array.isArray(value.parameters)) value.parameters.forEach((parameter, index) => { mediaObject(parameter, [...path, 'parameters', index]) })
    if (depth < 16 && isRecord(value.callbacks)) for (const callbackName of Object.keys(value.callbacks).sort(compareText)) {
      const callback = value.callbacks[callbackName]
      if (!isRecord(callback)) continue
      for (const expression of Object.keys(callback).sort(compareText)) pathItem(callback[expression], [...path, 'callbacks', callbackName, expression], depth + 1)
    }
  }
  function pathItem(value: unknown, path: Array<string | number>, depth: number): void {
    throwIfAborted(options.signal)
    if (!isRecord(value) || visitedPathItems.has(value) || depth > 16) return
    visitedPathItems.add(value)
    if (Array.isArray(value.parameters)) value.parameters.forEach((parameter, index) => { mediaObject(parameter, [...path, 'parameters', index]) })
    for (const method of [...operationMethods, 'query']) operation(value[method], [...path, method], depth)
    if (isRecord(value.additionalOperations)) for (const method of Object.keys(value.additionalOperations).sort(compareText)) operation(value.additionalOperations[method], [...path, 'additionalOperations', method], depth)
    visitedPathItems.delete(value)
  }
  const components = document.components
  if (isRecord(components)) {
    if (isRecord(components.mediaTypes)) for (const name of Object.keys(components.mediaTypes).sort(compareText)) {
      const media = components.mediaTypes[name]
      const path = ['components', 'mediaTypes', name]
      if (!isRecord(media)) continue
      if (typeof media.$ref === 'string') {
        ignored.add(JSON.stringify(path))
        continue
      }
      if (!Object.hasOwn(media, 'encoding')) continue
      if (Object.hasOwn(media, 'prefixEncoding')) conflict(path, 'prefixEncoding')
      if (Object.hasOwn(media, 'itemEncoding')) conflict(path, 'itemEncoding')
    }
    if (isRecord(components.callbacks)) for (const name of Object.keys(components.callbacks).sort(compareText)) {
      const callback = components.callbacks[name]
      if (!isRecord(callback)) continue
      for (const expression of Object.keys(callback).sort(compareText)) pathItem(callback[expression], ['components', 'callbacks', name, expression], 0)
    }
    if (isRecord(components.pathItems)) for (const name of Object.keys(components.pathItems).sort(compareText)) pathItem(components.pathItems[name], ['components', 'pathItems', name], 0)
    for (const group of ['requestBodies', 'responses', 'parameters', 'headers'] as const) {
      const entries = components[group]
      if (!isRecord(entries)) continue
      for (const name of Object.keys(entries).sort(compareText)) {
        const path = ['components', group, name]
        if (group === 'responses') response(entries[name], path)
        else mediaObject(entries[name], path)
      }
    }
  }
  for (const group of ['paths', 'webhooks'] as const) {
    const entries = document[group]
    if (isRecord(entries)) for (const name of Object.keys(entries).sort(compareText)) pathItem(entries[name], [group, name], 0)
  }
}

function addContentCardinalityDiagnostics(
  document: Record<string, unknown>,
  source: string,
  diagnostics: Diagnostic[],
  options: OpenapiExecutionOptions,
): void {
  const addParameter = (value: unknown, path: Array<string | number>) => {
    throwIfAborted(options.signal)
    if (!isRecord(value)) return
    if (value.in === 'querystring') {
      const is32 = String(document.openapi).startsWith('3.2.')
      if (!is32) diagnostics.push({ code: 'OPENAPI_QUERYSTRING_REQUIRES_32', severity: 'error', message: 'Querystring parameters require OpenAPI 3.2.', location: { source, path: [...path, 'in'] } })
      if (typeof value.name !== 'string' || value.name.length === 0) diagnostics.push({ code: 'OPENAPI_QUERYSTRING_NAME_REQUIRED', severity: 'error', message: 'A querystring Parameter Object requires a non-empty name.', location: { source, path: [...path, 'name'] } })
      if (!isRecord(value.content)) diagnostics.push({ code: 'OPENAPI_QUERYSTRING_CONTENT_REQUIRED', severity: 'error', message: 'A querystring Parameter Object requires content.', location: { source, path: [...path, 'content'] } })
      else if (Object.keys(value.content).length === 0) diagnostics.push({ code: 'OPENAPI_PARAMETER_CONTENT_CARDINALITY', severity: 'error', message: 'Parameter Object content must contain exactly one media type entry.', location: { source, path: [...path, 'content'] } })
      for (const field of ['schema', 'style', 'explode', 'allowReserved']) {
        if (Object.hasOwn(value, field)) diagnostics.push({ code: 'OPENAPI_QUERYSTRING_SCHEMA_FIELD', severity: 'error', message: `Querystring parameters cannot use ${field}.`, location: { source, path: [...path, field] } })
      }
    }
    if (!isRecord(value.content)) return
    if (Object.keys(value.content).length > 1) {
      diagnostics.push({
        code: 'OPENAPI_PARAMETER_CONTENT_CARDINALITY',
        severity: 'error',
        message: 'Parameter Object content must contain exactly one media type entry.',
        location: { source, path: [...path, 'content'] },
      })
    }
  }
  const addHeader = (header: unknown, path: Array<string | number>) => {
    throwIfAborted(options.signal)
    if (!isRecord(header) || !isRecord(header.content)) return
    if (Object.keys(header.content).length > 1) {
      diagnostics.push({
        code: 'OPENAPI_HEADER_CONTENT_CARDINALITY',
        severity: 'error',
        message: 'Header Object content must contain exactly one media type entry.',
        location: { source, path: [...path, 'content'] },
      })
    }
  }
  const addHeaders = (response: unknown, path: Array<string | number>) => {
    if (!isRecord(response) || !isRecord(response.headers)) return
    for (const name of Object.keys(response.headers).sort(compareText)) {
      addHeader(response.headers[name], [...path, 'headers', name])
    }
  }

  const components = document.components
  if (isRecord(components) && isRecord(components.parameters)) {
    for (const name of Object.keys(components.parameters).sort(compareText)) {
      addParameter(components.parameters[name], ['components', 'parameters', name])
    }
  }
  if (isRecord(components) && isRecord(components.headers)) {
    for (const name of Object.keys(components.headers).sort(compareText)) {
      addHeader(components.headers[name], ['components', 'headers', name])
    }
  }
  if (isRecord(components) && isRecord(components.responses)) {
    for (const name of Object.keys(components.responses).sort(compareText)) {
      addHeaders(components.responses[name], ['components', 'responses', name])
    }
  }

  if (!isRecord(document.paths)) return
  const methods = [
    ...operationMethods,
    ...(String(document.openapi).startsWith('3.2.') ? ['query'] : []),
  ]
  for (const pathName of Object.keys(document.paths).sort(compareText)) {
    throwIfAborted(options.signal)
    const pathItem = document.paths[pathName]
    if (!isRecord(pathItem)) continue
    if (Array.isArray(pathItem.parameters)) {
      pathItem.parameters.forEach((parameter, index) => {
        addParameter(parameter, ['paths', pathName, 'parameters', index])
      })
    }
    for (const method of methods) {
      const operation = pathItem[method]
      if (!isRecord(operation)) continue
      if (Array.isArray(operation.parameters)) {
        operation.parameters.forEach((parameter, index) => {
          addParameter(parameter, ['paths', pathName, method, 'parameters', index])
        })
      }
      if (!isRecord(operation.responses)) continue
      for (const statusCode of Object.keys(operation.responses).sort(compareText)) {
        addHeaders(
          operation.responses[statusCode],
          ['paths', pathName, method, 'responses', statusCode],
        )
      }
    }
    if (String(document.openapi).startsWith('3.2.') && isRecord(pathItem.additionalOperations)) {
      for (const method of Object.keys(pathItem.additionalOperations).sort(compareText)) {
        const operation = pathItem.additionalOperations[method]
        if (!isRecord(operation)) continue
        if (Array.isArray(operation.parameters)) {
          operation.parameters.forEach((parameter, index) => {
            addParameter(parameter, ['paths', pathName, 'additionalOperations', method, 'parameters', index])
          })
        }
        if (!isRecord(operation.responses)) continue
        for (const statusCode of Object.keys(operation.responses).sort(compareText)) {
          addHeaders(operation.responses[statusCode], ['paths', pathName, 'additionalOperations', method, 'responses', statusCode])
        }
      }
    }
  }
}

export function validateOpenAPIDocument(document: CompatibleOpenAPIDocument, source = '<object>', options: OpenapiExecutionOptions = {}): Diagnostic[] {
  throwIfAborted(options.signal)
  const diagnostics: Diagnostic[] = []
  const record = document as Record<string, unknown>
  const version = record.openapi
  if (typeof version !== 'string') {
    diagnostics.push({ code: 'OPENAPI_VALIDATION_FAILED', severity: 'error', message: 'The document must contain an openapi version string.', location: { source, path: ['openapi'] } })
    return diagnostics
  }
  const versionMatch = /^3\.(0|1|2)\.\d+(?:[-+].*)?$/.exec(version)
  if (!versionMatch) {
    diagnostics.push({ code: 'OPENAPI_UNSUPPORTED_VERSION', severity: 'error', message: `OpenAPI version ${version} is not supported.`, location: { source, path: ['openapi'] }, hint: 'Supported inputs are Swagger 2.0 and OpenAPI 3.0, 3.1, and the bounded OpenAPI 3.2 contract.' })
  } else if (versionMatch[1] === '2') {
    add32MediaDiagnostics(record, source, diagnostics, options)
    add32MetadataDiagnostics(record, source, diagnostics, options)
  }

  if (!isRecord(record.info)) {
    diagnostics.push({ code: 'OPENAPI_VALIDATION_FAILED', severity: 'error', message: 'info must be an object.', location: { source, path: ['info'] } })
  } else {
    if (typeof record.info.title !== 'string' || record.info.title.length === 0) diagnostics.push({ code: 'OPENAPI_VALIDATION_FAILED', severity: 'error', message: 'info.title must be a non-empty string.', location: { source, path: ['info', 'title'] } })
    if (typeof record.info.version !== 'string' || record.info.version.length === 0) diagnostics.push({ code: 'OPENAPI_VALIDATION_FAILED', severity: 'error', message: 'info.version must be a non-empty string.', location: { source, path: ['info', 'version'] } })
  }
  if (record.paths !== undefined && !isRecord(record.paths)) {
    diagnostics.push({ code: 'OPENAPI_VALIDATION_FAILED', severity: 'error', message: 'paths must be an object when present.', location: { source, path: ['paths'] } })
  }

  addContentCardinalityDiagnostics(record, source, diagnostics, options)

  const operationIds = new Map<string, Array<string | number>>()
  if (isRecord(record.paths)) {
    for (const pathName of Object.keys(record.paths).sort()) {
      throwIfAborted(options.signal)
      const pathItem = record.paths[pathName]
      if (!isRecord(pathItem)) continue
      const methods: string[] = [...operationMethods, ...(version.startsWith('3.2.') ? ['query'] : [])]
      const validateOperation = (operation: Record<string, unknown>, operationPath: Array<string | number>, wireMethod: string) => {
        if (!isRecord(operation.responses)) diagnostics.push({ code: 'OPENAPI_VALIDATION_FAILED', severity: 'error', message: `Operation ${wireMethod} ${pathName} must define responses.`, location: { source, path: [...operationPath, 'responses'] } })
        if (typeof operation.operationId === 'string') {
          const previous = operationIds.get(operation.operationId)
          if (previous) diagnostics.push({ code: 'OPENAPI_OPERATION_ID_DUPLICATE', severity: 'warning', message: `operationId ${operation.operationId} is duplicated.`, location: { source, path: [...operationPath, 'operationId'] }, hint: `First declared at ${previous.join('.')}.` })
          else operationIds.set(operation.operationId, [...operationPath, 'operationId'])
        }
        const parameters = [...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []), ...(Array.isArray(operation.parameters) ? operation.parameters : [])]
        parameters.forEach((parameter, index) => {
          if (isRecord(parameter) && parameter.in === 'path' && parameter.required !== true) diagnostics.push({ code: 'OPENAPI_VALIDATION_FAILED', severity: 'error', message: 'Path parameters must set required: true.', location: { source, path: [...operationPath, 'parameters', index, 'required'] } })
        })
        const effective = effectiveParameters(record, pathItem, operation, ['paths', pathName], operationPath)
        const querystrings = effective.filter(({ value }) => value.in === 'querystring')
        const queries = effective.filter(({ value }) => value.in === 'query')
        if (querystrings.length > 1) for (const extra of querystrings.slice(1)) diagnostics.push({ code: 'OPENAPI_QUERYSTRING_MULTIPLE', severity: 'error', message: 'An operation can have at most one effective querystring parameter.', location: { source, path: extra.path } })
        if (querystrings.length > 0 && queries[0]) diagnostics.push({ code: 'OPENAPI_QUERYSTRING_QUERY_CONFLICT', severity: 'error', message: 'An operation cannot combine query and querystring parameters.', location: { source, path: queries[0].path } })
      }
      for (const method of methods) {
        const operation = pathItem[method]
        if (operation === undefined) continue
        if (!isRecord(operation)) {
          diagnostics.push({ code: 'OPENAPI_VALIDATION_FAILED', severity: 'error', message: `Operation ${method.toUpperCase()} ${pathName} must be an object.`, location: { source, path: ['paths', pathName, method] } })
          continue
        }
        validateOperation(operation, ['paths', pathName, method], method.toUpperCase())
      }
      if (pathItem.additionalOperations !== undefined && !version.startsWith('3.2.')) {
        diagnostics.push({ code: 'OPENAPI_ADDITIONAL_OPERATIONS_REQUIRES_32', severity: 'error', message: 'additionalOperations is only valid in OpenAPI 3.2.', location: { source, path: ['paths', pathName, 'additionalOperations'] } })
      } else if (version.startsWith('3.2.') && pathItem.additionalOperations !== undefined && !isRecord(pathItem.additionalOperations)) {
        diagnostics.push({ code: 'OPENAPI_ADDITIONAL_OPERATIONS_INVALID', severity: 'error', message: 'additionalOperations must be an object map.', location: { source, path: ['paths', pathName, 'additionalOperations'] } })
      } else if (version.startsWith('3.2.') && isRecord(pathItem.additionalOperations)) {
        const fixedMethods = new Set([...operationMethods, 'query'].map((method) => method.toUpperCase()))
        for (const [method, operation] of Object.entries(pathItem.additionalOperations).sort(([left], [right]) => compareText(left, right))) {
          const operationPath = ['paths', pathName, 'additionalOperations', method] as Array<string | number>
          if (method.length > 128 || !httpMethodToken.test(method)) {
            diagnostics.push({ code: 'OPENAPI_ADDITIONAL_OPERATION_METHOD_INVALID', severity: 'error', message: 'An additionalOperations key must be a non-empty HTTP method token no longer than 128 characters.', location: { source, path: operationPath } })
          }
          if (fixedMethods.has(method.toUpperCase())) {
            diagnostics.push({ code: 'OPENAPI_ADDITIONAL_OPERATION_FIXED_METHOD_DUPLICATE', severity: 'error', message: `Additional operation ${method} duplicates a fixed Path Item operation method.`, location: { source, path: operationPath } })
          }
          if (!isRecord(operation)) {
            diagnostics.push({ code: 'OPENAPI_VALIDATION_FAILED', severity: 'error', message: `Additional operation ${method} ${pathName} must be an object.`, location: { source, path: operationPath } })
            continue
          }
          validateOperation(operation, operationPath, method)
        }
      }
    }
  }
  return sortDiagnostics(diagnostics)
}

export const HTTP_OPERATION_METHODS = operationMethods
