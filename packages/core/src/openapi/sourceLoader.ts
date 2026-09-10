import { createHash } from 'node:crypto'
import { lookup as lookupWithCallback } from 'node:dns'
import { lookup } from 'node:dns/promises'
import { lstat, open, realpath } from 'node:fs/promises'
import { Agent as HttpAgent } from 'node:http'
import { Agent as HttpsAgent } from 'node:https'
import { isIP, type LookupFunction } from 'node:net'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import axios from 'axios'
import converter from 'do-swagger2openapi'
import { CORE_SCHEMA, load as loadYaml, mergeTag } from 'js-yaml'

import { errorCause, sortDiagnostics, type Diagnostic } from '../diagnostics.ts'
import { throwIfAborted } from '../execution.ts'
import { classifyInputPath } from '../inputPath.ts'
import type { CompatibleOpenAPIDocument, OpenAPIAllDocument, RemoteSourceOptions } from '../types'

export type OpenAPIInput = string | URL | Record<string, unknown>

export interface SourceLoaderOptions {
  cwd?: string
  /** Restrict every local source, including transitive file references, to this real directory. */
  localFileRoot?: string
  remote?: RemoteSourceOptions
  cache?: Map<string, Promise<LoadedSource>>
  debug?: boolean
  signal?: AbortSignal
  /** Maximum bytes for a local source before parsing. Defaults to 64 MiB. */
  maxSourceBytes?: number
}

function isOutsideRoot(root: string, candidate: string): boolean {
  const relativePath = path.relative(root, candidate)
  return relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)
}

async function resolveRestrictedLocalPath(filePath: string, localFileRoot: string, debug = false): Promise<{ path?: string; diagnostics: Diagnostic[] }> {
  const lexicalRoot = path.resolve(localFileRoot)
  const lexicalPath = path.resolve(filePath)
  let root: string
  try {
    root = await realpath(lexicalRoot)
    const rootStat = await lstat(lexicalRoot)
    if (!rootStat.isDirectory()) throw new Error('The local file root is not a directory.')
  } catch (error) {
    return { diagnostics: [sourceDiagnostic('LOCAL_SOURCE_ROOT_INVALID', 'The configured local file root is unavailable.', lexicalRoot, error, debug)] }
  }
  const lexicallyInside = !isOutsideRoot(lexicalRoot, lexicalPath) || !isOutsideRoot(root, lexicalPath)
  if (!lexicallyInside) {
    return { diagnostics: [sourceDiagnostic('LOCAL_SOURCE_OUTSIDE_ROOT', 'Local OpenAPI sources must remain inside the configured local file root.', lexicalPath)] }
  }
  try {
    await lstat(lexicalPath)
    const canonicalPath = await realpath(lexicalPath)
    if (isOutsideRoot(root, canonicalPath)) {
      return { diagnostics: [sourceDiagnostic('LOCAL_SOURCE_SYMLINK_ESCAPE', 'Local OpenAPI sources may not escape the configured local file root through a symlink.', lexicalPath)] }
    }
    return { path: canonicalPath, diagnostics: [] }
  } catch (error) {
    return { diagnostics: [sourceDiagnostic('INPUT_READ_FAILED', 'Unable to read OpenAPI source.', lexicalPath, error, debug)] }
  }
}

export interface LoadedSource {
  source: string
  uri: string
  contentType?: string
  text?: string
  value?: Record<string, unknown>
  diagnostics: Diagnostic[]
  snapshot?: SourceSnapshot
}

export interface SourceSnapshot {
  source: string
  uri: string
  sha256: string
  bytes: number
  /** Identifies the compilation entry source when snapshots are returned by compileOpenAPI. */
  isRoot?: boolean
  localIdentity?: {
    device: string
    inode: string
    size: string
    modifiedNanoseconds: string
  }
}

export interface LoadedOpenAPIDocument {
  source: string
  uri: string
  document?: CompatibleOpenAPIDocument
  originalDocument?: OpenAPIAllDocument
  version?: string
  diagnostics: Diagnostic[]
  snapshot?: SourceSnapshot
}

function contentSnapshot(source: string, uri: string, content: string | Uint8Array, localIdentity?: SourceSnapshot['localIdentity']): SourceSnapshot {
  const bytes = typeof content === 'string' ? Buffer.from(content) : content
  return {
    source,
    uri,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.byteLength,
    ...(localIdentity ? { localIdentity } : {}),
  }
}

const defaultRemoteOptions: Required<Omit<RemoteSourceOptions, 'allowedHosts' | 'headers'>> = {
  allowPrivateNetwork: false,
  timeoutMs: 10_000,
  maxResponseBytes: 10 * 1024 * 1024,
  maxRedirects: 5,
}
export const DEFAULT_MAX_LOCAL_SOURCE_BYTES = 64 * 1024 * 1024

const OPENAPI_YAML_LOAD_OPTIONS = {
  schema: CORE_SCHEMA.withTags(mergeTag),
  maxDepth: 100,
  maxAliases: 100,
  maxTotalMergeKeys: 10_000,
} as const

function sanitizedRemoteSource(url: URL): string {
  const copy = new URL(url)
  copy.username = ''
  copy.password = ''
  copy.search = ''
  return copy.toString()
}

export function isSameRemoteOrigin(left: URL, right: URL): boolean {
  return left.origin === right.origin
}

export function isRemoteRedirectDowngrade(from: URL, to: URL): boolean {
  return from.protocol === 'https:' && to.protocol === 'http:'
}

function configuredRequestHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) return undefined
  const entries = Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'set-cookie')
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function hostMatches(hostname: string, pattern: string): boolean {
  const normalizedHostname = hostname.toLowerCase()
  const normalizedPattern = pattern.toLowerCase()
  if (normalizedPattern.startsWith('*.')) {
    const suffix = normalizedPattern.slice(1)
    return normalizedHostname.endsWith(suffix) && normalizedHostname.length > suffix.length
  }
  return normalizedHostname === normalizedPattern
}

function isPrivateIPv4(address: string): boolean {
  const octets = address.split('.').map(Number)
  const [a = 0, b = 0] = octets
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

function mappedIPv4Address(address: string): string | undefined {
  const suffix = address.toLowerCase().slice('::ffff:'.length)
  if (isIP(suffix) === 4) return suffix
  const words = suffix.split(':')
  if (words.length !== 2) return undefined
  const high = Number.parseInt(words[0] ?? '', 16)
  const low = Number.parseInt(words[1] ?? '', 16)
  if (!Number.isInteger(high) || !Number.isInteger(low) || high < 0 || high > 0xffff || low < 0 || low > 0xffff) {
    return undefined
  }
  return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`
}

export function isPrivateIPAddress(address: string): boolean {
  if (isIP(address) === 4) return isPrivateIPv4(address)
  if (isIP(address) !== 6) return false
  const normalized = address.toLowerCase()
  if (normalized.startsWith('::ffff:')) {
    const mapped = mappedIPv4Address(normalized)
    return mapped ? isPrivateIPv4(mapped) : true
  }
  return normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || /^fe[89ab]/.test(normalized)
}

export async function validateRemoteURL(url: URL, options: RemoteSourceOptions = {}, signal?: AbortSignal): Promise<Diagnostic[]> {
  throwIfAborted(signal)
  const source = sanitizedRemoteSource(url)
  const hostname = url.hostname.startsWith('[') && url.hostname.endsWith(']') ? url.hostname.slice(1, -1) : url.hostname
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return [{ code: 'REMOTE_SOURCE_BLOCKED', severity: 'error', message: `Remote protocol ${url.protocol} is not allowed.`, location: { source } }]
  }

  if (options.allowedHosts?.length && !options.allowedHosts.some((host) => hostMatches(hostname, host))) {
    return [{ code: 'REMOTE_SOURCE_BLOCKED', severity: 'error', message: `Remote host ${hostname} is not in allowedHosts.`, location: { source } }]
  }

  if (options.allowPrivateNetwork) return []
  if (hostname.toLowerCase() === 'localhost' || hostname.endsWith('.localhost')) {
    return [{ code: 'REMOTE_SOURCE_BLOCKED', severity: 'error', message: 'Localhost access is blocked by the remote source policy.', location: { source } }]
  }

  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true })
    throwIfAborted(signal)
    if (addresses.length === 0 || addresses.some(({ address }) => isPrivateIPAddress(address))) {
      return [{
        code: 'REMOTE_SOURCE_BLOCKED',
        severity: 'error',
        message: `Remote host ${hostname} resolves to a private, local, or reserved address.`,
        location: { source },
        hint: 'Set input.remote.allowPrivateNetwork only for trusted internal specifications; consider allowedHosts as an additional restriction.',
      }]
    }
  } catch (error) {
    return [{ code: 'REMOTE_SOURCE_FAILED', severity: 'error', message: `Unable to resolve remote host ${hostname}.`, location: { source }, cause: errorCause(error) }]
  }
  return []
}

function sourceDiagnostic(code: string, message: string, source: string, error?: unknown, debug = false): Diagnostic {
  return { code, severity: 'error', message, location: { source }, cause: errorCause(error, debug) }
}

class LocalSourceChangedError extends Error {
  constructor() {
    super('Local OpenAPI source changed during the read.')
    this.name = 'LocalSourceChangedError'
  }
}

function sanitizedRemoteCause(error: unknown, url: URL, debug = false): string | undefined {
  const cause = errorCause(error, debug)
  if (!cause) return undefined
  return cause.replaceAll(url.toString(), sanitizedRemoteSource(url)).replaceAll(`${url.origin}${url.pathname}${url.search}`, `${url.origin}${url.pathname}`)
}

function restrictedLookup(): LookupFunction {
  return (hostname, _options, callback) => {
    lookupWithCallback(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) {
        callback(error, '', 0)
        return
      }
      const address = addresses.find((candidate) => !isPrivateIPAddress(candidate.address))
      if (!address || addresses.some((candidate) => isPrivateIPAddress(candidate.address))) {
        const blocked = new Error(`Connection to ${hostname} was blocked because DNS resolved to a private, local, or reserved address.`) as NodeJS.ErrnoException
        blocked.code = 'EACCES'
        callback(blocked, '', 0)
        return
      }
      callback(null, address.address, address.family)
    })
  }
}

async function fetchRemoteSource(initialURL: URL, options: RemoteSourceOptions, debug = false, signal?: AbortSignal): Promise<LoadedSource> {
  const policy = { ...defaultRemoteOptions, ...options }
  const lookupAtConnection = policy.allowPrivateNetwork ? undefined : restrictedLookup()
  const httpAgent = lookupAtConnection ? new HttpAgent({ lookup: lookupAtConnection }) : undefined
  const httpsAgent = lookupAtConnection ? new HttpsAgent({ lookup: lookupAtConnection }) : undefined
  let currentURL = initialURL
  let requestHeaders = configuredRequestHeaders(options.headers)
  for (let redirect = 0; redirect <= policy.maxRedirects; redirect += 1) {
    throwIfAborted(signal)
    const diagnostics = await validateRemoteURL(currentURL, policy, signal)
    if (diagnostics.length > 0) return { source: sanitizedRemoteSource(currentURL), uri: currentURL.toString(), diagnostics }
    const source = sanitizedRemoteSource(currentURL)
    try {
      const response = await axios.get<string>(currentURL.toString(), {
        headers: requestHeaders,
        httpAgent,
        httpsAgent,
        maxBodyLength: policy.maxResponseBytes,
        maxContentLength: policy.maxResponseBytes,
        maxRedirects: 0,
        responseType: 'text',
        timeout: policy.timeoutMs,
        transformResponse: [(value) => value],
        validateStatus: () => true,
        signal,
      })
      if (response.status >= 300 && response.status < 400 && response.headers.location) {
        if (redirect === policy.maxRedirects) {
          return { source, uri: currentURL.toString(), diagnostics: [sourceDiagnostic('REMOTE_SOURCE_REDIRECT_LIMIT', 'Remote source exceeded the redirect limit.', source)] }
        }
        const nextURL = new URL(response.headers.location, currentURL)
        if (isRemoteRedirectDowngrade(currentURL, nextURL)) {
          const redirectSource = sanitizedRemoteSource(nextURL)
          return {
            source: redirectSource,
            uri: nextURL.toString(),
            diagnostics: [
              sourceDiagnostic(
                'REMOTE_SOURCE_REDIRECT_DOWNGRADE_BLOCKED',
                'Remote source redirect from HTTPS to HTTP is blocked.',
                redirectSource,
              ),
            ],
          }
        }
        if (!isSameRemoteOrigin(currentURL, nextURL)) requestHeaders = undefined
        currentURL = nextURL
        continue
      }
      if (response.status < 200 || response.status >= 300) {
        return { source, uri: currentURL.toString(), diagnostics: [sourceDiagnostic('REMOTE_SOURCE_FAILED', `Remote source returned HTTP ${response.status}.`, source)] }
      }
      const text = typeof response.data === 'string' ? response.data : String(response.data)
      if (Buffer.byteLength(text) > policy.maxResponseBytes) {
        return { source, uri: currentURL.toString(), diagnostics: [sourceDiagnostic('REMOTE_SOURCE_TOO_LARGE', `Remote source exceeds the ${policy.maxResponseBytes} byte limit.`, source)] }
      }
      const contentType = response.headers['content-type']
      return {
        source,
        uri: currentURL.toString(),
        contentType: typeof contentType === 'string' ? contentType : undefined,
        text,
        diagnostics: [],
        snapshot: contentSnapshot(source, currentURL.toString(), text),
      }
    } catch (error) {
      throwIfAborted(signal)
      const axiosCode = axios.isAxiosError(error) ? error.code : undefined
      const code = axiosCode === 'ECONNABORTED' || axiosCode === 'ETIMEDOUT' ? 'REMOTE_SOURCE_TIMEOUT' : axiosCode === 'ERR_FR_MAX_BODY_LENGTH_EXCEEDED' || axiosCode === 'ERR_BAD_RESPONSE' ? 'REMOTE_SOURCE_TOO_LARGE' : 'REMOTE_SOURCE_FAILED'
      const diagnostic = sourceDiagnostic(code, code === 'REMOTE_SOURCE_TIMEOUT' ? 'Remote source request timed out.' : 'Unable to load remote source.', source)
      diagnostic.cause = sanitizedRemoteCause(error, currentURL, debug)
      return { source, uri: currentURL.toString(), diagnostics: [diagnostic] }
    }
  }
  return { source: sanitizedRemoteSource(initialURL), uri: initialURL.toString(), diagnostics: [] }
}

export async function loadSource(input: OpenAPIInput, options: SourceLoaderOptions = {}): Promise<LoadedSource> {
  throwIfAborted(options.signal)
  if (typeof input === 'object' && !(input instanceof URL)) {
    const text = JSON.stringify(input)
    return { source: '<object>', uri: 'memory://openapi', value: input, diagnostics: [], snapshot: contentSnapshot('<object>', 'memory://openapi', text) }
  }
  const raw = input instanceof URL ? input.toString() : input
  const inputKind = classifyInputPath(raw)
  let parsedURL: URL | undefined
  if (inputKind.endsWith('-url')) {
    try {
      parsedURL = new URL(raw)
    } catch {
      parsedURL = undefined
    }
  }
  if (parsedURL && parsedURL.protocol !== 'file:') {
    const key = parsedURL.toString()
    const cache = options.cache ?? new Map<string, Promise<LoadedSource>>()
    const cached = cache.get(key)
    if (cached) return cached
    const pending = fetchRemoteSource(parsedURL, options.remote ?? {}, options.debug, options.signal)
    cache.set(key, pending)
    return pending
  }

  let filePath = parsedURL?.protocol === 'file:' ? fileURLToPath(parsedURL) : path.resolve(options.cwd ?? process.cwd(), raw)
  if (options.localFileRoot) {
    const restricted = await resolveRestrictedLocalPath(filePath, options.localFileRoot, options.debug)
    if (!restricted.path) return { source: filePath, uri: pathToFileURL(filePath).toString(), diagnostics: restricted.diagnostics }
    filePath = restricted.path
  }
  const uri = pathToFileURL(filePath).toString()
  try {
    throwIfAborted(options.signal)
    const before = await lstat(filePath, { bigint: true })
    if (!before.isFile()) throw new Error('The OpenAPI source is not a regular file.')
    const maxSourceBytes = BigInt(options.maxSourceBytes ?? DEFAULT_MAX_LOCAL_SOURCE_BYTES)
    if (before.size > maxSourceBytes) {
      return { source: filePath, uri, diagnostics: [sourceDiagnostic('LOCAL_SOURCE_TOO_LARGE', `Local OpenAPI source exceeds the ${maxSourceBytes} byte limit.`, filePath)] }
    }
    const handle = await open(filePath, 'r')
    try {
      const opened = await handle.stat({ bigint: true })
      if (opened.dev !== before.dev || opened.ino !== before.ino) throw new LocalSourceChangedError()
      const text = await handle.readFile('utf8')
      throwIfAborted(options.signal)
      const after = await lstat(filePath, { bigint: true })
      if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || after.mtimeNs !== opened.mtimeNs) {
        return { source: filePath, uri, diagnostics: [sourceDiagnostic('LOCAL_SOURCE_CHANGED_DURING_READ', 'The OpenAPI source changed while it was being read; the result was discarded.', filePath)] }
      }
      return {
        source: filePath,
        uri,
        text,
        diagnostics: [],
        snapshot: contentSnapshot(filePath, uri, text, {
          device: opened.dev.toString(),
          inode: opened.ino.toString(),
          size: opened.size.toString(),
          modifiedNanoseconds: opened.mtimeNs.toString(),
        }),
      }
    } finally {
      await handle.close()
    }
  } catch (error) {
    throwIfAborted(options.signal)
    if (error instanceof LocalSourceChangedError) {
      return { source: filePath, uri, diagnostics: [sourceDiagnostic('LOCAL_SOURCE_CHANGED_DURING_READ', 'The OpenAPI source changed while it was being read; the result was discarded.', filePath)] }
    }
    return { source: filePath, uri, diagnostics: [sourceDiagnostic('INPUT_READ_FAILED', 'Unable to read OpenAPI source.', filePath, error, options.debug)] }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseOpenAPISource(source: LoadedSource, debug = false): { value?: Record<string, unknown>; diagnostics: Diagnostic[] } {
  if (source.value) return { value: source.value, diagnostics: [] }
  if (source.text === undefined) return { diagnostics: source.diagnostics }
  const text = source.text
  const likelyJSON = source.contentType?.toLowerCase().includes('json') || path.extname(new URL(source.uri).pathname).toLowerCase() === '.json' || /^[\s\uFEFF]*(?:\[|\{)/.test(text)
  const parsers: Array<() => unknown> = likelyJSON ? [() => JSON.parse(text), () => loadYaml(text, OPENAPI_YAML_LOAD_OPTIONS)] : [() => loadYaml(text, OPENAPI_YAML_LOAD_OPTIONS), () => JSON.parse(text)]
  let lastError: unknown
  for (const parse of parsers) {
    try {
      const value = parse()
      if (isRecord(value)) return { value, diagnostics: [] }
      lastError = new Error('The document root must be an object.')
    } catch (error) {
      lastError = error
    }
  }
  const mark = (lastError as { mark?: { line?: number; column?: number } } | undefined)?.mark
  const diagnostic = sourceDiagnostic('OPENAPI_PARSE_FAILED', 'Unable to parse OpenAPI document as JSON or YAML.', source.source, lastError, debug)
  if (mark?.line !== undefined) diagnostic.location = { ...diagnostic.location, line: mark.line + 1, column: (mark.column ?? 0) + 1 }
  return { diagnostics: [diagnostic] }
}

async function convertSwaggerDocument(document: Record<string, unknown>, source: string, debug = false): Promise<{ document?: CompatibleOpenAPIDocument; diagnostics: Diagnostic[] }> {
  if (typeof document.openapi === 'string') return { document: document as CompatibleOpenAPIDocument, diagnostics: [] }
  if (document.swagger !== '2.0') return { diagnostics: [] }
  try {
    const converted = await converter.convertObj(document as never, { warnOnly: true })
    return {
      document: converted.openapi as CompatibleOpenAPIDocument,
      diagnostics: [{ code: 'OPENAPI_SWAGGER_CONVERTED', severity: 'info', message: 'Swagger 2.0 input was converted to an OpenAPI 3 compatibility document for validation and generation.', location: { source } }],
    }
  } catch (error) {
    return { diagnostics: [sourceDiagnostic('OPENAPI_VALIDATION_FAILED', 'Unable to convert Swagger 2.0 document to OpenAPI 3.', source, error, debug)] }
  }
}

export async function loadOpenAPIDocument(input: OpenAPIInput, options: SourceLoaderOptions = {}): Promise<LoadedOpenAPIDocument> {
  throwIfAborted(options.signal)
  const source = await loadSource(input, options)
  throwIfAborted(options.signal)
  if (source.diagnostics.length > 0) return { source: source.source, uri: source.uri, diagnostics: sortDiagnostics(source.diagnostics), snapshot: source.snapshot }
  const parsed = parseOpenAPISource(source, options.debug)
  throwIfAborted(options.signal)
  if (!parsed.value) return { source: source.source, uri: source.uri, diagnostics: sortDiagnostics(parsed.diagnostics), snapshot: source.snapshot }
  const originalDocument = parsed.value as OpenAPIAllDocument
  const converted = await convertSwaggerDocument(parsed.value, source.source, options.debug)
  throwIfAborted(options.signal)
  const document = converted.document ?? (parsed.value as CompatibleOpenAPIDocument)
  const version = typeof parsed.value.openapi === 'string' ? parsed.value.openapi : typeof parsed.value.swagger === 'string' ? parsed.value.swagger : undefined
  return { source: source.source, uri: source.uri, originalDocument, document, version, diagnostics: sortDiagnostics(converted.diagnostics), snapshot: source.snapshot }
}
