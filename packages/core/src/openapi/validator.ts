import { type Diagnostic, sortDiagnostics } from '../diagnostics.ts'
import { type OpenapiExecutionOptions, throwIfAborted } from '../execution.ts'
import type { CompatibleOpenAPIDocument } from '../types'

const operationMethods = ['delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'trace'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function add32FieldWarnings(document: Record<string, unknown>, source: string, diagnostics: Diagnostic[], options: OpenapiExecutionOptions): void {
  const visit = (value: unknown, path: Array<string | number>) => {
    throwIfAborted(options.signal)
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) visit(value[index], [...path, index])
      return
    }
    if (!isRecord(value)) return
    for (const key of Object.keys(value).sort()) {
      const fieldPath = [...path, key]
      const parentKey = String(path.at(-1) ?? '')
      const is32Field =
        (path.length === 0 && key === '$self') ||
        (path.length === 1 && parentKey === 'info' && key === 'summary') ||
        key === 'additionalOperations' ||
        key === 'itemSchema' ||
        key === 'itemEncoding' ||
        key === 'prefixEncoding' ||
        (key === 'parent' && path.includes('tags')) ||
        (key === 'serializedValue' || key === 'dataValue') ||
        (key === 'query' && path.includes('paths')) ||
        (key === 'in' && value[key] === 'querystring')
      if (is32Field) {
        diagnostics.push({
          code: 'OPENAPI_32_FIELD_NOT_GENERATED',
          severity: 'warning',
          message: `OpenAPI 3.2 field ${fieldPath.map(String).join('.')} is preserved and inspected but is not yet consumed by existing code generators.`,
          location: { source, path: fieldPath },
        })
      }
      visit(value[key], fieldPath)
    }
  }
  visit(document, [])
}

function addContentCardinalityDiagnostics(
  document: Record<string, unknown>,
  source: string,
  diagnostics: Diagnostic[],
  options: OpenapiExecutionOptions,
): void {
  const addParameter = (value: unknown, path: Array<string | number>) => {
    throwIfAborted(options.signal)
    if (!isRecord(value) || !isRecord(value.content)) return
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
    diagnostics.push({ code: 'OPENAPI_UNSUPPORTED_VERSION', severity: 'error', message: `OpenAPI version ${version} is not supported.`, location: { source, path: ['openapi'] }, hint: 'Supported inputs are Swagger 2.0 and OpenAPI 3.0, 3.1, and compatibility-mode 3.2.' })
  } else if (versionMatch[1] === '2') {
    diagnostics.push({
      code: 'OPENAPI_32_COMPATIBILITY',
      severity: 'warning',
      message: 'OpenAPI 3.2 is recognized and safely parsed in compatibility mode; existing generators still use the OpenAPI 3.1 data model.',
      location: { source, path: ['openapi'] },
      hint: '3.2-only fields are preserved but may not affect generated output.',
    })
    add32FieldWarnings(record, source, diagnostics, options)
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
      for (const method of methods) {
        const operation = pathItem[method]
        if (operation === undefined) continue
        if (!isRecord(operation)) {
          diagnostics.push({ code: 'OPENAPI_VALIDATION_FAILED', severity: 'error', message: `Operation ${method.toUpperCase()} ${pathName} must be an object.`, location: { source, path: ['paths', pathName, method] } })
          continue
        }
        if (!isRecord(operation.responses)) diagnostics.push({ code: 'OPENAPI_VALIDATION_FAILED', severity: 'error', message: `Operation ${method.toUpperCase()} ${pathName} must define responses.`, location: { source, path: ['paths', pathName, method, 'responses'] } })
        if (typeof operation.operationId === 'string') {
          const previous = operationIds.get(operation.operationId)
          if (previous) diagnostics.push({ code: 'OPENAPI_OPERATION_ID_DUPLICATE', severity: 'warning', message: `operationId ${operation.operationId} is duplicated.`, location: { source, path: ['paths', pathName, method, 'operationId'] }, hint: `First declared at ${previous.join('.')}.` })
          else operationIds.set(operation.operationId, ['paths', pathName, method, 'operationId'])
        }
        const parameters = [...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []), ...(Array.isArray(operation.parameters) ? operation.parameters : [])]
        parameters.forEach((parameter, index) => {
          if (isRecord(parameter) && parameter.in === 'path' && parameter.required !== true) diagnostics.push({ code: 'OPENAPI_VALIDATION_FAILED', severity: 'error', message: 'Path parameters must set required: true.', location: { source, path: ['paths', pathName, method, 'parameters', index, 'required'] } })
        })
      }
      if (version.startsWith('3.2.') && isRecord(pathItem.additionalOperations)) {
        for (const [method, operation] of Object.entries(pathItem.additionalOperations).sort(([left], [right]) => compareText(left, right))) {
          if (!isRecord(operation) || !isRecord(operation.responses)) diagnostics.push({ code: 'OPENAPI_VALIDATION_FAILED', severity: 'error', message: `Additional operation ${method} ${pathName} must be an object with responses.`, location: { source, path: ['paths', pathName, 'additionalOperations', method] } })
        }
      }
    }
  }
  return sortDiagnostics(diagnostics)
}

export const HTTP_OPERATION_METHODS = operationMethods
