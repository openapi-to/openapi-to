export const FETCH_RUNTIME_NAME = "fetch-runtime.ts";

export const fetchRuntimeSource = `
export type FetchRequestConfig = Omit<RequestInit, "method" | "body" | "headers" | "duplex"> & {
  baseURL?: string | URL;
  headers?: HeadersInit;
};

export class FetchTransportError extends Error {
  readonly kind: "configuration" | "network" | "abort" | "decode" | "validation";
  readonly cause?: unknown;
  constructor(kind: FetchTransportError["kind"], message: string, cause?: unknown) {
    super(message);
    this.name = "FetchTransportError";
    this.kind = kind;
    this.cause = cause;
  }
}

export class FetchHttpError<T = unknown> extends Error {
  readonly kind = "http" as const;
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly url: string;
  readonly body: T | undefined;
  readonly response: Response;
  readonly cause?: unknown;
  constructor(response: Response, body: T | undefined, cause?: unknown) {
    super("HTTP request failed with status " + response.status);
    this.name = "FetchHttpError";
    this.status = response.status;
    this.statusText = response.statusText;
    this.headers = response.headers;
    this.url = response.url;
    this.body = body;
    this.response = response;
    this.cause = cause;
  }
}

export type FetchRequestError<T = unknown> = FetchHttpError<T> | FetchTransportError;
const fetchLimits = { headers: 100, headerBytes: 8192, fields: 1000, bodyBytes: 8 * 1024 * 1024, urlBytes: 8192 } as const;

export function resolveFetchUrl(value: string, baseURL?: string | URL): URL {
  let result: URL;
  try {
    if (/^[\\/]{2}/.test(value)) throw new Error();
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) result = new URL(value);
    else {
      const base = baseURL !== undefined
        ? new URL(baseURL)
        : typeof globalThis.location?.href === "string" ? new URL(globalThis.location.href) : undefined;
      if (!base) throw new Error();
      result = new URL(value, base);
      if (result.origin !== base.origin) throw new Error();
    }
  } catch (cause) {
    throw new FetchTransportError("configuration", "Unable to resolve request URL.", cause);
  }
  if (result.protocol !== "http:" && result.protocol !== "https:") {
    throw new FetchTransportError("configuration", "Only HTTP and HTTPS request URLs are supported.");
  }
  if (new TextEncoder().encode(result.href).byteLength > fetchLimits.urlBytes) throw new FetchTransportError("configuration", "Request URL exceeds the supported size.");
  return result;
}

function headerEntries(input: HeadersInit | undefined): Array<[string, string]> {
  if (input === undefined) return [];
  const entries: Array<[string, string]> = [];
  try {
    if (input instanceof Headers) input.forEach((value, name) => entries.push([name, value]));
    else if (Array.isArray(input)) {
      for (const pair of input) {
        if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || typeof pair[1] !== "string") throw new Error();
        entries.push([pair[0], pair[1]]);
      }
    } else {
      if (input === null || typeof input !== "object") throw new Error();
      const prototype = Object.getPrototypeOf(input);
      if (prototype !== Object.prototype && prototype !== null) throw new Error();
      if (Object.getOwnPropertySymbols(input).length !== 0) throw new Error();
      const descriptors = Object.getOwnPropertyDescriptors(input);
      for (const name of Object.keys(descriptors)) {
        const descriptor = descriptors[name];
        if (!descriptor || !Object.hasOwn(descriptor, "value") || typeof descriptor.value !== "string") throw new Error();
        entries.push([name, descriptor.value]);
      }
    }
  } catch (cause) {
    throw new FetchTransportError("configuration", "Invalid request headers.", cause);
  }
  if (entries.length > fetchLimits.headers || entries.reduce((size, [name, value]) => size + new TextEncoder().encode(name + value).byteLength, 0) > fetchLimits.headerBytes) {
    throw new FetchTransportError("configuration", "Request headers exceed the supported size.");
  }
  return entries;
}

export function mergeFetchHeaders(...layers: Array<HeadersInit | undefined>): Headers {
  const result = new Headers();
  for (const layer of layers) {
    const seen = new Set<string>();
    for (const [name, value] of headerEntries(layer)) {
      const identity = name.toLowerCase();
      if (seen.has(identity)) throw new FetchTransportError("configuration", "Duplicate case-insensitive header in one header source.");
      seen.add(identity);
      try {
        result.set(name, value);
      } catch (cause) {
        throw new FetchTransportError("configuration", "Invalid request header.", cause);
      }
    }
  }
  return result;
}

function record(value: unknown, label: string): Record<string, unknown> {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error();
    if (Object.getOwnPropertySymbols(value).length !== 0) throw new Error();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors);
    if (keys.length > 100) throw new Error();
    const result: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) throw new Error();
      result[key] = descriptor.value;
    }
    return result;
  } catch (cause) {
    throw new FetchTransportError("configuration", label, cause);
  }
}

function arrayValues(value: unknown, label: string): unknown[] {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length !== 0 || value.length > 100 || Object.getOwnPropertyNames(value).length !== value.length + 1) throw new Error();
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw new Error();
      result.push(descriptor.value);
    }
    return result;
  } catch (cause) {
    throw new FetchTransportError("configuration", label, cause);
  }
}

function primitive(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  throw new FetchTransportError("configuration", "Unsupported form field value.");
}

export function encodeFetchUrlForm(value: unknown): URLSearchParams {
  const input = record(value, "Form body must be a flat object.");
  const output = new URLSearchParams();
  let fields = 0;
  for (const key of Object.keys(input).sort()) {
    const item = input[key];
    if (item === undefined) continue;
    if (Array.isArray(item)) {
      for (const member of arrayValues(item, "Form array is unsupported or exceeds the supported size.")) {
        fields += 1;
        if (fields > fetchLimits.fields) throw new FetchTransportError("configuration", "Form body exceeds the supported field count.");
        output.append(key, primitive(member));
      }
    } else {
      fields += 1;
      if (fields > fetchLimits.fields) throw new FetchTransportError("configuration", "Form body exceeds the supported field count.");
      output.append(key, primitive(item));
    }
  }
  if (new TextEncoder().encode(output.toString()).byteLength > fetchLimits.bodyBytes) throw new FetchTransportError("configuration", "Form body exceeds the supported size.");
  return output;
}

export function encodeFetchMultipart(value: unknown): FormData {
  const input = record(value, "Multipart body must be a flat object.");
  const output = new FormData();
  let fields = 0;
  let bodyBytes = 0;
  for (const key of Object.keys(input).sort()) {
    const item = input[key];
    if (item === undefined) continue;
    const add = (member: unknown): void => {
      fields += 1;
      if (fields > fetchLimits.fields) throw new FetchTransportError("configuration", "Multipart body exceeds the supported field count.");
      const memberBytes = typeof member === "string" ? new TextEncoder().encode(member).byteLength : ((typeof Blob !== "undefined" && member instanceof Blob) || (typeof File !== "undefined" && member instanceof File)) ? member.size : undefined;
      if (memberBytes === undefined) throw new FetchTransportError("configuration", "Unsupported multipart field value.");
      bodyBytes += new TextEncoder().encode(key).byteLength + memberBytes;
      if (bodyBytes > fetchLimits.bodyBytes) throw new FetchTransportError("configuration", "Multipart body exceeds the supported size.");
      if (typeof member === "string") output.append(key, member);
      else if ((typeof Blob !== "undefined" && member instanceof Blob) || (typeof File !== "undefined" && member instanceof File)) output.append(key, member);
      else throw new FetchTransportError("configuration", "Unsupported multipart field value.");
    };
    if (Array.isArray(item)) {
      for (const member of arrayValues(item, "Multipart array is unsupported or exceeds the supported size.")) add(member);
    } else add(item);
  }
  return output;
}

export function serializeFetchQuery(value: unknown, allowed: string[]): URLSearchParams {
  if (value === undefined) return new URLSearchParams();
  const input = record(value, "Query parameters must be a plain object.");
  const output = new URLSearchParams();
  const known = new Set(allowed);
  let fields = 0;
  const append = (name: string, member: unknown): void => {
    fields += 1;
    if (fields > fetchLimits.fields) throw new FetchTransportError("configuration", "Query exceeds the supported field count.");
    output.append(name, primitive(member));
  };
  for (const key of Object.keys(input).sort()) {
    if (!known.has(key)) throw new FetchTransportError("configuration", "Unknown OpenAPI query parameter.");
    const item = input[key];
    if (item === undefined) continue;
    if (Array.isArray(item)) {
      for (const member of arrayValues(item, "Query array is unsupported or exceeds the supported size.")) append(key, member);
    } else if (item !== null && typeof item === "object") {
      // OpenAPI form + explode=true serializes object properties as independent
      // query names. Keep the Request plugin's style decision in generation and
      // accept only the bounded flat shape that this runtime can serialize.
      const members = record(item, "Compound OpenAPI query value must be a flat object.");
      for (const memberName of Object.keys(members).sort()) {
        const member = members[memberName];
        if (member === undefined) continue;
        if (Array.isArray(member)) {
          for (const value of arrayValues(member, "Query object array is unsupported or exceeds the supported size.")) append(memberName, value);
        } else if (member !== null && typeof member === "object") {
          throw new FetchTransportError("configuration", "Nested OpenAPI query values are unsupported by the Fetch transport.");
        } else append(memberName, member);
      }
    } else append(key, item);
  }
  if (new TextEncoder().encode(output.toString()).byteLength > fetchLimits.urlBytes) throw new FetchTransportError("configuration", "Query exceeds the supported size.");
  return output;
}

export function serializeFetchHeaderParameters(value: unknown, metadata: Array<{ name: string; required: boolean; style: string; explode: boolean }>): Headers {
  const input = value === undefined ? Object.create(null) as Record<string, unknown> : record(value, "Header parameters must be a plain object.");
  const allowed = new Map(metadata.map((item) => [item.name.toLowerCase(), item]));
  const seen = new Set<string>();
  const output = new Headers();
  for (const suppliedName of Object.keys(input)) {
    const identity = suppliedName.toLowerCase();
    if (seen.has(identity) || !allowed.has(identity)) throw new FetchTransportError("configuration", "Duplicate or unknown OpenAPI Header parameter.");
    seen.add(identity);
  }
  for (const item of metadata) {
    if (item.style !== "simple") throw new FetchTransportError("configuration", "Unsupported OpenAPI Header style.");
    const key = Object.keys(input).find((name) => name.toLowerCase() === item.name.toLowerCase());
    const value = key === undefined ? undefined : input[key];
    if (value === undefined) {
      if (item.required) throw new FetchTransportError("configuration", "Required OpenAPI Header parameter is missing.");
      continue;
    }
    let serialized: string;
    if (Array.isArray(value)) serialized = arrayValues(value, "Header array is unsupported or exceeds the supported size.").map(primitive).join(",");
    else if (value !== null && typeof value === "object") {
      const object = record(value, "Compound OpenAPI Header values must be plain objects.");
      const pairs = Object.keys(object).sort().map((name) => [name, primitive(object[name])] as const);
      serialized = pairs.map(([name, member]) => item.explode ? name + "=" + member : name + "," + member).join(",");
    } else serialized = primitive(value);
    try { output.set(item.name, serialized); }
    catch (cause) { throw new FetchTransportError("configuration", "Invalid OpenAPI Header parameter.", cause); }
  }
  return output;
}

function media(value: string | null): string | undefined {
  if (!value) return undefined;
  const normalized = value.split(";", 1)[0]?.trim().toLowerCase();
  return normalized || undefined;
}

function family(value: string): "json" | "text" | "blob" | undefined {
  if (value === "application/json" || value === "application/*+json" || /^application\\/[!#$%&'*+.^_\\x60|~0-9a-z-]+\\+json$/.test(value)) return "json";
  if (value.startsWith("text/")) return "text";
  if (["application/octet-stream", "application/pdf", "application/zip", "application/vnd.ms-excel", "application/msword", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "image/jpeg", "image/png", "image/gif", "audio/mpeg", "video/mp4"].includes(value)) return "blob";
  return undefined;
}

function responseReadError(cause: unknown, message: string, signal?: AbortSignal | null): FetchTransportError {
  const aborted = signal?.aborted || (cause instanceof Error && cause.name === "AbortError");
  return new FetchTransportError(aborted ? "abort" : "decode", aborted ? "Response body reading was aborted." : message, cause);
}

export async function decodeFetchResponse(response: Response, declared: string[], signal?: AbortSignal | null): Promise<unknown> {
  const actual = media(response.headers.get("content-type"));
  if (!actual) throw new FetchTransportError("decode", "Response Content-Type is missing.");
  const actualFamily = family(actual);
  if (!actualFamily) throw new FetchTransportError("decode", "Response Content-Type is unsupported.");
  const matches = declared.filter((item) => {
    const normalized = item.toLowerCase().split(";", 1)[0]?.trim() ?? "";
    return normalized === actual || (normalized.endsWith("/*") && actual.startsWith(normalized.slice(0, -1))) || (normalized === "application/*+json" && /^application\\/[!#$%&'*+.^_\\x60|~0-9a-z-]+\\+json$/.test(actual));
  });
  if (matches.length !== 1 || family(matches[0]!.toLowerCase()) !== actualFamily) throw new FetchTransportError("decode", "Response Content-Type does not match a declared response media type.");
  if (response.body) {
    const reader = response.clone().body?.getReader();
    if (reader) {
      let responseBytes = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          responseBytes += chunk.value.byteLength;
          if (responseBytes > fetchLimits.bodyBytes) {
            void reader.cancel().catch(() => undefined);
            throw new FetchTransportError("decode", "Response body exceeds the supported size.");
          }
        }
      } catch (cause) {
        if (cause instanceof FetchTransportError) throw cause;
        throw responseReadError(cause, "Unable to read response body.", signal);
      }
    }
  }
  try {
    if (actualFamily === "json") return await response.json();
    if (actualFamily === "text") return await response.text();
    return await response.blob();
  } catch (cause) {
    throw responseReadError(cause, "Unable to decode response body.", signal);
  }
}

export async function callFetch<T>(url: URL, method: string, config: FetchRequestConfig | undefined, body: BodyInit | undefined, generatedHeaders: HeadersInit, typedHeaders: HeadersInit, declared: string[], responseMedia: Record<string, string[]>, zodParse?: (value: unknown) => T): Promise<T | undefined> {
  const options = { ...(config ?? {}) } as RequestInit & { baseURL?: string | URL };
  delete (options as Record<string, unknown>).method;
  delete (options as Record<string, unknown>).body;
  delete (options as Record<string, unknown>).duplex;
  delete (options as Record<string, unknown>).headers;
  delete (options as Record<string, unknown>).baseURL;
  const headers = mergeFetchHeaders(generatedHeaders, typedHeaders, config?.headers);
  const init: RequestInit = { ...options, method, ...(body === undefined ? {} : { body }), headers };
  if ((method === "GET" || method === "HEAD") && body !== undefined) throw new FetchTransportError("configuration", "GET and HEAD requests cannot include a body.");
  let response: Response;
  try {
    response = await globalThis.fetch(url, init);
  } catch (cause) {
    const aborted = config?.signal?.aborted || (cause instanceof Error && cause.name === "AbortError");
    throw new FetchTransportError(aborted ? "abort" : "network", aborted ? "Request was aborted." : "Network request failed.", cause);
  }
  const noContent = method === "HEAD" || response.status === 204 || response.status === 205;
  const statusKey = String(response.status);
  const statusRangeKey = Object.keys(responseMedia).find((key) => /^[1-5]XX$/i.test(key) && Number(key[0]) === Math.floor(response.status / 100));
  const hasStatusMap = Object.keys(responseMedia).length > 0;
  const hasDeclaredStatus = Object.hasOwn(responseMedia, statusKey) || statusRangeKey !== undefined || Object.hasOwn(responseMedia, "default") || !hasStatusMap;
  const declaredForStatus = responseMedia[statusKey] ?? (statusRangeKey === undefined ? undefined : responseMedia[statusRangeKey]) ?? responseMedia.default ?? (hasStatusMap ? [] : declared);
  if (!hasDeclaredStatus && response.ok && !noContent) throw new FetchTransportError("decode", "Response status is not declared by the operation.");
  if (noContent || !declaredForStatus || declaredForStatus.length === 0) {
    if (!response.ok) throw new FetchHttpError(response, undefined);
    return undefined;
  }
  let decoded: unknown;
  try {
    decoded = await decodeFetchResponse(response, declaredForStatus, config?.signal);
  } catch (cause) {
    if (cause instanceof FetchTransportError && cause.kind === "abort") throw cause;
    if (!response.ok) throw new FetchHttpError(response, undefined, cause);
    throw cause instanceof FetchTransportError ? cause : new FetchTransportError("decode", "Unable to decode response body.", cause);
  }
  if (!response.ok) throw new FetchHttpError(response, decoded);
  if (zodParse) {
    try { return zodParse(decoded); }
    catch (cause) { throw new FetchTransportError("validation", "Response validation failed.", cause); }
  }
  return decoded as T;
}
`;
