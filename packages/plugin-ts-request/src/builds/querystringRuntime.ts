import { resolveJSONPointer, type OperationWrapper } from '@openapi-to/core'

const querystringLimits = { properties: 100, arrayItems: 100, jsonNodes: 1000, jsonDepth: 20, bytes: 8192 } as const

export function querystringTransportIssue(operation: OperationWrapper): string | undefined {
  const parameter = operation.accessor.querystringParameter
  if (!parameter) return undefined
  const mediaType = operation.accessor.querystringContentType
  if (mediaType !== 'application/x-www-form-urlencoded' && mediaType !== 'application/json') return 'Unsupported OpenAPI querystring media type.'
  const media = parameter.content?.[mediaType] as Record<string, unknown> | undefined
  if (!media) return 'OpenAPI querystring media entry is missing.'
  if (media.encoding && typeof media.encoding === 'object' && Object.keys(media.encoding).length > 0) return 'Explicit OpenAPI querystring encoding is unsupported.'
  if (mediaType === 'application/json') return media.schema === undefined ? 'OpenAPI JSON querystring transport requires a schema.' : undefined
  let schema: unknown = media.schema
  const seen = new Set<string>()
  for (let depth = 0; depth < 20 && schema && typeof schema === 'object' && '$ref' in schema && typeof schema.$ref === 'string'; depth += 1) {
    if (seen.has(schema.$ref)) return 'Cyclic OpenAPI form querystring schema is unsupported.'
    seen.add(schema.$ref)
    const resolved = resolveJSONPointer(operation.accessor.operation.api, schema.$ref)
    schema = resolved.found ? resolved.value : undefined
  }
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return 'OpenAPI form querystring requires a supported object schema.'
  const root = schema as Record<string, unknown>
  if ('oneOf' in root || 'anyOf' in root || 'allOf' in root || 'not' in root || root.type !== 'object') return 'OpenAPI form querystring requires a supported object schema.'
  const properties = root.properties
  if (properties !== undefined && (typeof properties !== 'object' || properties === null || Array.isArray(properties))) return 'OpenAPI form querystring properties are unsupported.'
  if (root.required !== undefined && (!Array.isArray(root.required) || root.required.length > querystringLimits.properties || root.required.some((name) => typeof name !== 'string' || name.length > querystringLimits.bytes))) return 'OpenAPI form querystring required properties are unsupported.'
  const entries = Object.values((properties ?? {}) as Record<string, unknown>)
  if (entries.length > querystringLimits.properties) return 'OpenAPI form querystring property limit exceeded.'
  const primitive = (value: unknown): boolean => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const item = value as Record<string, unknown>
    return !('$ref' in item) && !('oneOf' in item) && !('anyOf' in item) && !('allOf' in item) && item.nullable !== true && ['string', 'number', 'integer', 'boolean'].includes(String(item.type)) && !Array.isArray(item.type) && !(item.type === 'string' && item.format === 'binary')
  }
  const supportedValue = (value: unknown): boolean =>
    primitive(value) || Boolean(value && typeof value === 'object' && !Array.isArray(value) && (value as Record<string, unknown>).type === 'array' && primitive((value as Record<string, unknown>).items))
  for (const value of entries) {
    if (!supportedValue(value)) return 'OpenAPI form querystring property shape is unsupported.'
  }
  const additional = root.additionalProperties
  if (additional !== undefined && additional !== false && !supportedValue(additional)) return 'OpenAPI form querystring additionalProperties shape is unsupported.'
  if (entries.length === 0 && additional === false) return 'OpenAPI form querystring cannot produce a non-empty query.'
  return undefined
}

function requiredFormProperties(operation: OperationWrapper): string[] {
  const mediaType = operation.accessor.querystringContentType
  if (mediaType !== 'application/x-www-form-urlencoded') return []
  let schema: unknown = operation.accessor.querystringParameter?.content?.[mediaType]?.schema
  const seen = new Set<string>()
  for (let depth = 0; depth < 20 && schema && typeof schema === 'object' && '$ref' in schema && typeof schema.$ref === 'string'; depth += 1) {
    if (seen.has(schema.$ref)) return []
    seen.add(schema.$ref)
    const resolved = resolveJSONPointer(operation.accessor.operation.api, schema.$ref)
    schema = resolved.found ? resolved.value : undefined
  }
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return []
  const required = (schema as Record<string, unknown>).required
  return Array.isArray(required) ? required.filter((name): name is string => typeof name === 'string').sort() : []
}

// This source is emitted inside a generated request function. It only reads own
// data descriptors and produces a complete, bounded query component.
const runtime = `
const querystringFailure = (reason: string): never => { throw new Error('OpenAPI querystring: ' + reason); };
const querystringLimits = ${JSON.stringify(querystringLimits)} as const;
const querystringBytes = (value: string): number => new TextEncoder().encode(value).byteLength;
const querystringRecord = (value: unknown): Record<string, unknown> => {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return querystringFailure('expected a plain object');
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return querystringFailure('expected a plain object');
    if (Object.getOwnPropertySymbols(value).length !== 0) return querystringFailure('symbol properties are unsupported');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors);
    if (keys.length > querystringLimits.properties) return querystringFailure('property limit exceeded');
    const record: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) return querystringFailure('accessor properties are unsupported');
      Object.defineProperty(record, key, { value: descriptor.value, enumerable: true, configurable: true });
    }
    return record;
  } catch { return querystringFailure('unsafe object'); }
};
const querystringPrimitive = (value: unknown): string => {
  if (typeof value === 'string') {
    if (value.length > querystringLimits.bytes || querystringBytes(value) > querystringLimits.bytes) return querystringFailure('byte limit exceeded');
    return value;
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return querystringFailure('unsupported form value');
};
const querystringForm = (value: unknown): string => {
  const input = querystringRecord(value);
  for (const key of requiredQuerystringProperties) if (!Object.hasOwn(input, key) || input[key] === undefined) return querystringFailure('required form property is missing');
  const pairs: string[] = [];
  let totalBytes = 0;
  const append = (key: string, value: unknown) => {
    if (key.length > querystringLimits.bytes) return querystringFailure('byte limit exceeded');
    const pair = new URLSearchParams();
    pair.append(key, querystringPrimitive(value));
    const text = pair.toString();
    totalBytes += querystringBytes(text) + (pairs.length === 0 ? 0 : 1);
    if (totalBytes > querystringLimits.bytes) return querystringFailure('byte limit exceeded');
    pairs.push(text);
  };
  for (const key of Object.keys(input).sort()) {
    const member = input[key];
    if (member === undefined) continue;
    if (Array.isArray(member)) {
      if (member.length === 0 || member.length > querystringLimits.arrayItems) return querystringFailure('unsupported form array length');
      if (Object.getPrototypeOf(member) !== Array.prototype || Object.getOwnPropertySymbols(member).length !== 0 || Object.getOwnPropertyNames(member).length !== member.length + 1) return querystringFailure('unsafe form array');
      for (let index = 0; index < member.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(member, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) return querystringFailure('unsupported form array item');
        append(key, descriptor.value);
      }
    } else append(key, member);
  }
  if (pairs.length === 0) return querystringFailure('provided form value has no pairs');
  return pairs.join('&');
};
const querystringJson = (value: unknown): string => {
  let nodes = 0;
  const seen = new Set<object>();
  const clone = (input: unknown, depth: number): unknown => {
    nodes += 1;
    if (depth > querystringLimits.jsonDepth || nodes > querystringLimits.jsonNodes) return querystringFailure('JSON limit exceeded');
    if (input === null || typeof input === 'boolean') return input;
    if (typeof input === 'string') {
      if (querystringBytes(input) > querystringLimits.bytes) return querystringFailure('byte limit exceeded');
      return input;
    }
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (Array.isArray(input)) {
      if (seen.has(input) || input.length > querystringLimits.arrayItems || Object.getPrototypeOf(input) !== Array.prototype || Object.getOwnPropertySymbols(input).length !== 0 || Object.getOwnPropertyNames(input).length !== input.length + 1) return querystringFailure('unsafe JSON array');
      seen.add(input);
      const output: unknown[] = Object.setPrototypeOf([], null);
      for (let index = 0; index < input.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) return querystringFailure('unsafe JSON array item');
        output[index] = clone(descriptor.value, depth + 1);
      }
      seen.delete(input);
      return output;
    }
    if (typeof input !== 'object' || input === null || seen.has(input)) return querystringFailure('unsupported JSON value');
    seen.add(input);
    const record = querystringRecord(input);
    if (Object.hasOwn(record, 'toJSON')) return querystringFailure('custom toJSON is unsupported');
    const output: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(record).sort()) output[key] = clone(record[key], depth + 1);
    seen.delete(input);
    return output;
  };
  const normalized = clone(value, 0);
  const json = JSON.stringify(normalized);
  if (typeof json !== 'string') return querystringFailure('unsupported JSON value');
  const encoded = encodeURIComponent(json).replace(/[!'()*]/g, (char) => '%' + char.charCodeAt(0).toString(16).toUpperCase());
  if (querystringBytes(encoded) > querystringLimits.bytes) return querystringFailure('byte limit exceeded');
  return encoded;
};
`

export function buildQuerystringTransport(operation: OperationWrapper): string {
  const media = operation.accessor.querystringContentType
  if (!media) return ''
  const serialize = media === 'application/x-www-form-urlencoded' ? 'querystringForm' : 'querystringJson'
  const required = operation.accessor.isQuerystringRequired
  return `const requiredQuerystringProperties = new Set<string>(${JSON.stringify(requiredFormProperties(operation))});\n${runtime}\nlet rawQuerystring: unknown;\ntry { rawQuerystring = (input as { querystring?: unknown }).querystring; } catch { querystringFailure('unable to read input'); }\nif (rawQuerystring === undefined && ${required}) querystringFailure('required value is missing');\nconst querystringText = rawQuerystring === undefined ? undefined : ${serialize}(rawQuerystring);`
}
