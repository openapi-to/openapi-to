import type { CompatibleOpenAPIDocument } from '../types'
import { throwIfAborted, type OpenapiExecutionOptions } from '../execution.ts'
import { enumerateOpenAPIOperations, type OpenAPIOperationSource } from '../openapi/operations.ts'

export type OpenAPIChangeClassification = 'breaking' | 'non-breaking' | 'warning' | 'informational'

export interface OpenAPIChange {
  classification: OpenAPIChangeClassification
  code: string
  message: string
  path: Array<string | number>
  before?: unknown
  after?: unknown
}

export interface OpenAPIDiffResult {
  breaking: boolean
  changes: OpenAPIChange[]
  summary: { breaking: number; nonBreaking: number; warnings: number; informational: number }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((item, index) => sameValue(item, right[index]))
  if (typeof left === 'object' && left !== null && typeof right === 'object' && right !== null) {
    const leftKeys = Object.keys(left as object).sort()
    const rightKeys = Object.keys(right as object).sort()
    return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && sameValue((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]))
  }
  return false
}

function parameterMap(pathItem: Record<string, unknown>, operation: Record<string, unknown>): Map<string, Record<string, unknown>> {
  const parameters = [...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []), ...(Array.isArray(operation.parameters) ? operation.parameters : [])]
  return new Map(
    parameters
      .filter((parameter): parameter is Record<string, unknown> => typeof parameter === 'object' && parameter !== null && !Array.isArray(parameter) && typeof parameter.name === 'string' && typeof parameter.in === 'string')
      .map((parameter) => [`${parameter.in}:${parameter.name}`, parameter]),
  )
}

function responseSchema(response: unknown): unknown {
  const content = record(record(response).content)
  return Object.fromEntries(Object.keys(content).sort().map((mediaType) => [mediaType, record(content[mediaType]).schema]))
}

function requestSchema(operation: Record<string, unknown>): unknown {
  const body = record(operation.requestBody)
  const content = record(body.content)
  return Object.fromEntries(Object.keys(content).sort().map((mediaType) => [mediaType, record(content[mediaType]).schema]))
}

export function diffOpenAPIDocuments(beforeDocument: CompatibleOpenAPIDocument, afterDocument: CompatibleOpenAPIDocument, options: OpenapiExecutionOptions = {}): OpenAPIDiffResult {
  throwIfAborted(options.signal)
  const changes: OpenAPIChange[] = []
  const add = (classification: OpenAPIChangeClassification, code: string, message: string, path: Array<string | number>, before?: unknown, after?: unknown) => {
    changes.push({ classification, code, message, path, ...(before !== undefined ? { before } : {}), ...(after !== undefined ? { after } : {}) })
  }
  const beforeRoot = beforeDocument as Record<string, unknown>
  const afterRoot = afterDocument as Record<string, unknown>
  const beforePaths = record(beforeRoot.paths)
  const afterPaths = record(afterRoot.paths)
  const beforeOperations = enumerateOpenAPIOperations(beforeDocument)
  const afterOperations = enumerateOpenAPIOperations(afterDocument)
  const operationIdentity = (source: OpenAPIOperationSource) => `${source.sourceKind}\0${source.sourceMethod}`
  const pathNames = [...new Set([...Object.keys(beforePaths), ...Object.keys(afterPaths)])].sort()
  for (const pathName of pathNames) {
    throwIfAborted(options.signal)
    if (!(pathName in beforePaths)) {
      add('non-breaking', 'PATH_ADDED', `Path ${pathName} was added.`, ['paths', pathName])
      continue
    }
    if (!(pathName in afterPaths)) {
      add('breaking', 'PATH_REMOVED', `Path ${pathName} was removed.`, ['paths', pathName])
      continue
    }
    const beforePath = record(beforePaths[pathName])
    const afterPath = record(afterPaths[pathName])
    const beforeByIdentity = new Map(beforeOperations.filter((source) => source.path === pathName).map((source) => [operationIdentity(source), source]))
    const afterByIdentity = new Map(afterOperations.filter((source) => source.path === pathName).map((source) => [operationIdentity(source), source]))
    const identities = [...new Set([...beforeByIdentity.keys(), ...afterByIdentity.keys()])].sort(compareText)
    for (const identity of identities) {
      const beforeSource = beforeByIdentity.get(identity)
      const afterSource = afterByIdentity.get(identity)
      const beforeOperation = beforeSource?.operation ?? {}
      const afterOperation = afterSource?.operation ?? {}
      const had = beforeSource !== undefined
      const has = afterSource !== undefined
      const source = afterSource ?? beforeSource
      if (!source) continue
      const location = source.sourcePath
      const method = source.wireMethod
      if (!had && has) {
        add('non-breaking', 'OPERATION_ADDED', `${method} ${pathName} was added.`, location)
        continue
      }
      if (had && !has) {
        add('breaking', 'OPERATION_REMOVED', `${method} ${pathName} was removed.`, location)
        continue
      }
      if (!had) continue
      if (beforeOperation.operationId !== afterOperation.operationId) add('breaking', 'OPERATION_ID_CHANGED', `operationId changed for ${method} ${pathName}.`, [...location, 'operationId'], beforeOperation.operationId, afterOperation.operationId)

      const beforeParameters = parameterMap(beforePath, beforeOperation)
      const afterParameters = parameterMap(afterPath, afterOperation)
      for (const name of [...new Set([...beforeParameters.keys(), ...afterParameters.keys()])].sort()) {
        const beforeParameter = beforeParameters.get(name)
        const afterParameter = afterParameters.get(name)
        const parameterPath = [...location, 'parameters', name]
        if (!beforeParameter && afterParameter) add(afterParameter.required === true ? 'breaking' : 'non-breaking', 'PARAMETER_ADDED', `Parameter ${name} was added.`, parameterPath)
        else if (beforeParameter && !afterParameter) add('breaking', 'PARAMETER_REMOVED', `Parameter ${name} was removed.`, parameterPath)
        else if (beforeParameter && afterParameter) {
          if (beforeParameter.required !== afterParameter.required) add(afterParameter.required === true ? 'breaking' : 'non-breaking', 'PARAMETER_REQUIRED_CHANGED', `Required state changed for parameter ${name}.`, [...parameterPath, 'required'], beforeParameter.required === true, afterParameter.required === true)
          compareSchema(record(beforeParameter.schema), record(afterParameter.schema), [...parameterPath, 'schema'], add, options)
        }
      }

      const beforeBody = record(beforeOperation.requestBody)
      const afterBody = record(afterOperation.requestBody)
      if (Object.keys(beforeBody).length === 0 && Object.keys(afterBody).length > 0) add(afterBody.required === true ? 'breaking' : 'non-breaking', 'REQUEST_BODY_ADDED', 'Request body was added.', [...location, 'requestBody'])
      else if (Object.keys(beforeBody).length > 0 && Object.keys(afterBody).length === 0) add('breaking', 'REQUEST_BODY_REMOVED', 'Request body was removed.', [...location, 'requestBody'])
      else if (!sameValue(requestSchema(beforeOperation), requestSchema(afterOperation))) add('breaking', 'REQUEST_BODY_SCHEMA_CHANGED', 'Request body schema changed.', [...location, 'requestBody', 'content'])
      if (beforeBody.required !== afterBody.required && Object.keys(beforeBody).length && Object.keys(afterBody).length) add(afterBody.required === true ? 'breaking' : 'non-breaking', 'REQUEST_BODY_REQUIRED_CHANGED', 'Request body required state changed.', [...location, 'requestBody', 'required'], beforeBody.required === true, afterBody.required === true)

      const beforeResponses = record(beforeOperation.responses)
      const afterResponses = record(afterOperation.responses)
      for (const status of [...new Set([...Object.keys(beforeResponses), ...Object.keys(afterResponses)])].sort()) {
        if (!(status in beforeResponses)) add('non-breaking', 'RESPONSE_ADDED', `Response ${status} was added.`, [...location, 'responses', status])
        else if (!(status in afterResponses)) add('breaking', 'RESPONSE_REMOVED', `Response ${status} was removed.`, [...location, 'responses', status])
        else if (!sameValue(responseSchema(beforeResponses[status]), responseSchema(afterResponses[status]))) add('breaking', 'RESPONSE_SCHEMA_CHANGED', `Response ${status} schema changed.`, [...location, 'responses', status, 'content'])
      }
    }
  }

  const beforeSchemas = record(record(beforeRoot.components).schemas)
  const afterSchemas = record(record(afterRoot.components).schemas)
  for (const schemaName of [...new Set([...Object.keys(beforeSchemas), ...Object.keys(afterSchemas)])].sort()) {
    const location = ['components', 'schemas', schemaName] as Array<string | number>
    if (!(schemaName in beforeSchemas)) add('non-breaking', 'SCHEMA_ADDED', `Component schema ${schemaName} was added.`, location)
    else if (!(schemaName in afterSchemas)) add('breaking', 'SCHEMA_REMOVED', `Component schema ${schemaName} was removed.`, location)
    else compareSchema(record(beforeSchemas[schemaName]), record(afterSchemas[schemaName]), location, add, options)
  }

  const classificationOrder: Record<OpenAPIChangeClassification, number> = { breaking: 0, warning: 1, 'non-breaking': 2, informational: 3 }
  changes.sort((left, right) => compareText(left.path.map(String).join('\u0000'), right.path.map(String).join('\u0000')) || classificationOrder[left.classification] - classificationOrder[right.classification] || compareText(left.code, right.code))
  const summary = { breaking: 0, nonBreaking: 0, warnings: 0, informational: 0 }
  for (const change of changes) {
    if (change.classification === 'breaking') summary.breaking += 1
    else if (change.classification === 'non-breaking') summary.nonBreaking += 1
    else if (change.classification === 'warning') summary.warnings += 1
    else summary.informational += 1
  }
  return { breaking: summary.breaking > 0, changes, summary }
}

function compareSchema(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  path: Array<string | number>,
  add: (classification: OpenAPIChangeClassification, code: string, message: string, path: Array<string | number>, before?: unknown, after?: unknown) => void,
  options: OpenapiExecutionOptions,
): void {
  throwIfAborted(options.signal)
  if (before.type !== after.type) add('breaking', 'SCHEMA_TYPE_CHANGED', 'Schema type changed.', [...path, 'type'], before.type, after.type)
  const beforeProperties = record(before.properties)
  const afterProperties = record(after.properties)
  const beforeRequired = new Set(Array.isArray(before.required) ? before.required.filter((item): item is string => typeof item === 'string') : [])
  const afterRequired = new Set(Array.isArray(after.required) ? after.required.filter((item): item is string => typeof item === 'string') : [])
  for (const property of [...new Set([...Object.keys(beforeProperties), ...Object.keys(afterProperties)])].sort()) {
    const propertyPath = [...path, 'properties', property]
    if (!(property in beforeProperties)) add(afterRequired.has(property) ? 'breaking' : 'non-breaking', 'SCHEMA_PROPERTY_ADDED', `Property ${property} was added.`, propertyPath)
    else if (!(property in afterProperties)) add('breaking', 'SCHEMA_PROPERTY_REMOVED', `Property ${property} was removed.`, propertyPath)
    else compareSchema(record(beforeProperties[property]), record(afterProperties[property]), propertyPath, add, options)
    if (beforeRequired.has(property) !== afterRequired.has(property)) add(afterRequired.has(property) ? 'breaking' : 'non-breaking', 'SCHEMA_PROPERTY_REQUIRED_CHANGED', `Required state changed for property ${property}.`, [...path, 'required', property], beforeRequired.has(property), afterRequired.has(property))
  }
  const beforeEnum = new Set(Array.isArray(before.enum) ? before.enum.map((item) => JSON.stringify(item)) : [])
  const afterEnum = new Set(Array.isArray(after.enum) ? after.enum.map((item) => JSON.stringify(item)) : [])
  for (const item of [...beforeEnum].filter((item) => !afterEnum.has(item)).sort()) add('breaking', 'SCHEMA_ENUM_VALUE_REMOVED', `Enum value ${item} was removed.`, [...path, 'enum'])
  for (const item of [...afterEnum].filter((item) => !beforeEnum.has(item)).sort()) add('non-breaking', 'SCHEMA_ENUM_VALUE_ADDED', `Enum value ${item} was added.`, [...path, 'enum'])
  const tracked = new Set(['type', 'properties', 'required', 'enum'])
  const beforeOther = Object.fromEntries(Object.entries(before).filter(([key]) => !tracked.has(key)))
  const afterOther = Object.fromEntries(Object.entries(after).filter(([key]) => !tracked.has(key)))
  if (!sameValue(beforeOther, afterOther)) {
    add('warning', 'SCHEMA_CONSTRAINT_CHANGED', 'Schema constraints or composition changed; compatibility cannot be classified reliably by the first-stage diff engine.', path, beforeOther, afterOther)
  }
}
