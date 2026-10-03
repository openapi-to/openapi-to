import { sortDiagnostics, type Diagnostic } from '../../diagnostics.ts'
import { getOperationCatalogState } from './internal.ts'
import { resolveOperationContractLimits, type ResolvedOperationContractLimits } from './limits.ts'
import { effectiveParameters } from '../effectiveParameters.ts'
import type {
  GetOperationContractOptions,
  OperationCatalog,
  OperationContentContract,
  OperationContract,
  OperationContractResult,
  OperationParameterContract,
  OperationResponseContract,
  OperationSchemaSummary,
} from './types.ts'

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function safeValue(value: unknown, depth = 0): unknown {
  if (depth > 3) return '[truncated]'
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return value.slice(0, 1_000)
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => safeValue(item, depth + 1))
  const object = record(value)
  if (!object) return undefined
  return Object.fromEntries(Object.keys(object).sort().slice(0, 20).map((key) => [key, safeValue(object[key], depth + 1)]))
}

function schemaName(ref: string): string | undefined {
  const match = /#\/components\/schemas\/([^/]+)$/.exec(ref)
  return match?.[1] ? decodeURIComponent(match[1].replaceAll('~1', '/').replaceAll('~0', '~')) : undefined
}

interface SchemaContext {
  components: Record<string, unknown>
  limits: ResolvedOperationContractLimits
  truncation: Set<string>
  unresolved: Set<string>
  visited: Set<string>
  summarizedSchemas: Set<string>
}

function summarizeSchema(value: unknown, context: SchemaContext, depth: number, name?: string): OperationSchemaSummary | undefined {
  const schema = record(value)
  if (!schema) return undefined
  const ref = typeof schema.$ref === 'string' ? schema.$ref : undefined
  const refName = ref ? schemaName(ref) : undefined
  const schemaIdentity = refName ?? name
  if (schemaIdentity && !context.summarizedSchemas.has(schemaIdentity)) {
    if (context.summarizedSchemas.size >= context.limits.maxSchemas) {
      context.truncation.add('maxSchemas')
      return { name: schemaIdentity, ...(ref ? { ref } : {}) }
    }
    context.summarizedSchemas.add(schemaIdentity)
  }
  if (depth > context.limits.schemaDepth) {
    context.truncation.add('schemaDepth')
    return { ...(name || refName ? { name: name ?? refName } : {}), ...(ref ? { ref } : {}) }
  }
  if (ref) {
    if (!refName || !record(context.components[refName])) {
      context.unresolved.add(ref)
      return { ...(refName ? { name: refName } : {}), ref }
    }
    if (context.visited.has(refName)) return { name: refName, ref, circular: true }
    context.visited.add(refName)
    const resolved = summarizeSchema(context.components[refName], context, depth, refName) ?? { name: refName }
    context.visited.delete(refName)
    return { ...resolved, name: refName, ref }
  }
  const summary: OperationSchemaSummary = {
    ...(name ? { name } : {}),
    ...(typeof schema.type === 'string' || (Array.isArray(schema.type) && schema.type.every((item) => typeof item === 'string')) ? { type: schema.type as string | string[] } : {}),
    ...(typeof schema.format === 'string' ? { format: schema.format } : {}),
    ...(typeof schema.description === 'string' ? { description: schema.description.slice(0, 2_000) } : {}),
    ...(schema.nullable === true ? { nullable: true } : {}),
    ...(Array.isArray(schema.required) ? { required: schema.required.filter((item): item is string => typeof item === 'string').sort() } : {}),
    ...(Array.isArray(schema.enum) ? { enum: schema.enum.slice(0, 100).map((item) => safeValue(item)) } : {}),
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 100) context.truncation.add('enumValues')
  const properties = record(schema.properties)
  if (properties) {
    const names = Object.keys(properties).sort()
    if (names.length > context.limits.maxPropertiesPerSchema) context.truncation.add('maxPropertiesPerSchema')
    const required = new Set(summary.required ?? [])
    summary.properties = names.slice(0, context.limits.maxPropertiesPerSchema).map((propertyName) => ({
      name: propertyName,
      required: required.has(propertyName),
      schema: summarizeSchema(properties[propertyName], context, depth + 1) ?? {},
    }))
  }
  const items = summarizeSchema(schema.items, context, depth + 1)
  if (items) summary.items = items
  for (const keyword of ['allOf', 'oneOf', 'anyOf'] as const) {
    if (!Array.isArray(schema[keyword])) continue
    summary[keyword] = schema[keyword].slice(0, 20).map((item) => summarizeSchema(item, context, depth + 1) ?? {})
    if (schema[keyword].length > 20) context.truncation.add(keyword)
  }
  if (typeof schema.additionalProperties === 'boolean') summary.additionalProperties = schema.additionalProperties
  else {
    const additional = summarizeSchema(schema.additionalProperties, context, depth + 1)
    if (additional) summary.additionalProperties = additional
  }
  const discriminator = record(schema.discriminator)
  if (discriminator) {
    const mapping = record(discriminator.mapping)
    summary.discriminator = {
      ...(typeof discriminator.propertyName === 'string' ? { propertyName: discriminator.propertyName } : {}),
      ...(mapping ? { mapping: Object.fromEntries(Object.entries(mapping).filter((entry): entry is [string, string] => typeof entry[1] === 'string').sort(([a], [b]) => compareText(a, b))) } : {}),
    }
  }
  if (context.limits.includeExamples && Object.hasOwn(schema, 'example')) summary.example = safeValue(schema.example)
  return summary
}

function resolveLocalComponent(value: unknown, group: string, root: Record<string, unknown>): Record<string, unknown> | undefined {
  const object = record(value)
  if (!object || typeof object.$ref !== 'string') return object
  const match = new RegExp(`^#/components/${group}/([^/]+)$`).exec(object.$ref)
  if (!match?.[1]) return object
  return record(record(record(root.components)?.[group])?.[decodeURIComponent(match[1])]) ?? object
}

function parameterContracts(pathItem: Record<string, unknown>, operation: Record<string, unknown>, root: Record<string, unknown>, schemaContext: SchemaContext): OperationContract['parameters'] {
  const values = effectiveParameters(root, pathItem, operation)
  const all: OperationParameterContract[] = []
  for (const { value: parameter } of values.slice(0, 200)) {
    const location = parameter?.in
    if (typeof parameter?.name !== 'string' || !['path', 'query', 'header', 'cookie'].includes(String(location))) continue
    const schema = summarizeSchema(parameter.schema, schemaContext, 0)
    const contract: OperationParameterContract = {
      name: parameter.name,
      in: location as OperationParameterContract['in'],
      required: parameter.required === true || location === 'path',
      ...(typeof parameter.description === 'string' ? { description: parameter.description.slice(0, 2_000) } : {}),
      ...(schema ? { schema } : {}),
      ...(schemaContext.limits.includeExamples && Object.hasOwn(parameter, 'example') ? { example: safeValue(parameter.example) } : {}),
    }
    all.push(contract)
  }
  if (values.length > 200) schemaContext.truncation.add('parameters')
  all.sort((a, b) => compareText(a.in, b.in) || compareText(a.name, b.name))
  return {
    path: all.filter((parameter) => parameter.in === 'path'),
    query: all.filter((parameter) => parameter.in === 'query'),
    header: all.filter((parameter) => parameter.in === 'header'),
    cookie: all.filter((parameter) => parameter.in === 'cookie'),
  }
}

function contentContracts(value: unknown, schemaContext: SchemaContext): OperationContentContract[] {
  const content = record(value) ?? {}
  const types = Object.keys(content).sort()
  if (types.length > 20) schemaContext.truncation.add('contentTypes')
  return types.slice(0, 20).map((contentType) => {
    const media = record(content[contentType]) ?? {}
    const schema = summarizeSchema(media.schema, schemaContext, 0)
    return {
      contentType,
      ...(schema ? { schema } : {}),
      ...(schemaContext.limits.includeExamples && Object.hasOwn(media, 'example') ? { example: safeValue(media.example) } : {}),
    }
  })
}

function collectRootSchemaNames(operation: Record<string, unknown>): string[] {
  const names = new Set<string>()
  const seen = new WeakSet<object>()
  const visit = (value: unknown) => {
    if (typeof value !== 'object' || value === null || seen.has(value)) return
    seen.add(value)
    if (Array.isArray(value)) return value.forEach(visit)
    const object = value as Record<string, unknown>
    if (typeof object.$ref === 'string') {
      const name = schemaName(object.$ref)
      if (name) names.add(name)
    }
    for (const key of Object.keys(object).sort()) visit(object[key])
  }
  visit(operation.requestBody)
  const responseMap = record(operation.responses) ?? {}
  const statuses = Object.keys(responseMap).sort((a, b) => {
    const aSuccess = /^2(?:\d\d|XX)$/i.test(a)
    const bSuccess = /^2(?:\d\d|XX)$/i.test(b)
    return Number(bSuccess) - Number(aSuccess) || compareText(a, b)
  })
  for (const status of statuses) visit(responseMap[status])
  return [...names]
}

function responses(operation: Record<string, unknown>, root: Record<string, unknown>, schemaContext: SchemaContext): OperationResponseContract[] {
  const responseMap = record(operation.responses) ?? {}
  const statuses = Object.keys(responseMap).sort((a, b) => {
    const aSuccess = /^2(?:\d\d|XX)$/i.test(a)
    const bSuccess = /^2(?:\d\d|XX)$/i.test(b)
    return Number(bSuccess) - Number(aSuccess) || compareText(a, b)
  })
  if (statuses.length > 100) schemaContext.truncation.add('responses')
  return statuses.slice(0, 100).map((status) => {
    const response = resolveLocalComponent(responseMap[status], 'responses', root) ?? {}
    return {
      status,
      ...(typeof response.description === 'string' ? { description: response.description.slice(0, 2_000) } : {}),
      success: /^2(?:\d\d|XX)$/i.test(status),
      content: contentContracts(response.content, schemaContext),
    }
  })
}

function securityRequirements(operation: Record<string, unknown>, root: Record<string, unknown>): Array<Record<string, string[]>> {
  const security = Array.isArray(operation.security) ? operation.security : Array.isArray(root.security) ? root.security : []
  return security.slice(0, 50).map((requirement) => {
    const object = record(requirement) ?? {}
    return Object.fromEntries(Object.keys(object).sort().map((name) => [name, Array.isArray(object[name]) ? object[name].filter((scope): scope is string => typeof scope === 'string').sort() : []]))
  })
}

function byteLength(result: Omit<OperationContractResult, 'byteLength'>): number {
  return Buffer.byteLength(JSON.stringify(result))
}

function enforceByteLimit(result: Omit<OperationContractResult, 'byteLength'>, maxBytes: number): void {
  const contentBudget = Math.max(512, maxBytes - 32)
  if (byteLength(result) <= contentBudget || !result.operation) return
  result.truncated = true
  if (!result.truncationReasons.includes('maxBytes')) result.truncationReasons.push('maxBytes')
  const operation = result.operation
  while (operation.schemas?.length && byteLength(result) > contentBudget) operation.schemas.pop()
  while (operation.responses?.length && byteLength(result) > contentBudget) operation.responses.pop()
  if (byteLength(result) > contentBudget) delete operation.querystring
  for (const key of ['cookie', 'header', 'query', 'path'] as const) {
    while (operation.parameters?.[key].length && byteLength(result) > contentBudget) operation.parameters[key].pop()
  }
  if (byteLength(result) > contentBudget) delete operation.description
  if (byteLength(result) > contentBudget) delete operation.parameters
  if (byteLength(result) > contentBudget) delete operation.requestBody
  if (byteLength(result) > contentBudget) delete operation.responses
  if (byteLength(result) > contentBudget) delete operation.schemas
  if (byteLength(result) > contentBudget) operation.requestSchemaNames = []
  if (byteLength(result) > contentBudget) operation.responseSchemaNames = []
}

function diagnosticPath(pointer: string): Array<string | number> {
  return pointer.split('/').slice(1).map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
}

export function getOperationContract(catalog: OperationCatalog, operationKey: string, options: GetOperationContractOptions = {}): OperationContractResult {
  const detail = options.detail ?? 'contract'
  const state = getOperationCatalogState(catalog)
  const entry = state.entries.get(operationKey)
  if (!entry) {
    const diagnostics: Diagnostic[] = [{ code: 'OPERATION_NOT_FOUND', severity: 'error', message: `Operation key was not found: ${operationKey}` }]
    const result = { ...(catalog.target ? { target: catalog.target } : {}), found: false, detail, diagnostics, truncated: false, truncationReasons: [], unresolvedSchemaRefs: [] }
    return { ...result, byteLength: byteLength(result) }
  }
  const item = entry.item
  const itemPath = diagnosticPath(item.sourcePointer)
  const operation: OperationContract = {
    operationKey: item.operationKey,
    ...(item.operationId ? { operationId: item.operationId } : {}),
    method: item.method,
    path: item.path,
    tags: item.tags,
    ...(item.summary ? { summary: item.summary } : {}),
    ...(detail === 'contract' && item.description ? { description: item.description } : {}),
    deprecated: item.deprecated,
    requestSchemaNames: item.requestSchemaNames,
    responseSchemaNames: item.responseSchemaNames,
  }
  const limits = resolveOperationContractLimits(options)
  const truncation = new Set<string>()
  const unresolved = new Set<string>()
  if (detail === 'contract') {
    const root = state.resolvedDocument as Record<string, unknown>
    const components = record(record(root.components)?.schemas) ?? {}
    const schemaContext: SchemaContext = { components, limits, truncation, unresolved, visited: new Set(), summarizedSchemas: new Set() }
    const pathItem = entry.resolvedPathItem ?? entry.pathItem
    const resolvedOperation = entry.resolvedOperation ?? entry.operation
    operation.parameters = parameterContracts(pathItem, resolvedOperation, root, schemaContext)
    if (String(root.openapi).startsWith('3.2.')) {
      const querystring = effectiveParameters(root, pathItem, resolvedOperation).find(({ value }) => value.in === 'querystring')?.value
      if (querystring && typeof querystring.name === 'string') {
        const content = contentContracts(querystring.content, schemaContext)[0]
        if (content) operation.querystring = {
          name: querystring.name,
          required: querystring.required === true,
          ...(typeof querystring.description === 'string' ? { description: querystring.description.slice(0, 2_000) } : {}),
          content,
        }
      }
    }
    const requestBody = resolveLocalComponent(resolvedOperation.requestBody, 'requestBodies', root)
    if (requestBody) operation.requestBody = { required: requestBody.required === true, content: contentContracts(requestBody.content, schemaContext) }
    operation.responses = responses(resolvedOperation, root, schemaContext)
    operation.securityRequirements = securityRequirements(resolvedOperation, root)
    const schemaNames = collectRootSchemaNames(entry.operation)
    if (schemaNames.length > limits.maxSchemas) truncation.add('maxSchemas')
    operation.schemas = schemaNames.slice(0, limits.maxSchemas).map((name) => summarizeSchema(components[name], schemaContext, 0, name) ?? { name })
  }
  const result: Omit<OperationContractResult, 'byteLength'> = {
    ...(catalog.target ? { target: catalog.target } : {}),
    found: true,
    detail,
    operation,
    diagnostics: sortDiagnostics(catalog.diagnostics.filter((diagnostic) => JSON.stringify(diagnostic.location?.path) === JSON.stringify(itemPath))),
    truncated: truncation.size > 0,
    truncationReasons: [...truncation].sort(),
    unresolvedSchemaRefs: [...unresolved].sort(),
  }
  enforceByteLimit(result, limits.maxBytes)
  result.truncationReasons.sort()
  return { ...result, byteLength: byteLength(result) }
}
