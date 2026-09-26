import { createHash } from 'node:crypto'
import { lstat, open, realpath } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import converter from 'do-swagger2openapi'
import { load as loadYaml } from 'js-yaml'

import { errorCause, sortDiagnostics, type Diagnostic } from '../diagnostics.ts'
import { throwIfAborted } from '../execution.ts'
import { classifyInputPath } from '../inputPath.ts'
import type { CompatibleOpenAPIDocument, OpenAPIAllDocument, RemoteSourceOptions } from '../types'
import { remoteSourcePolicyIdentity } from '../config/remotePolicy.ts'
import { YAML_LOAD_OPTIONS } from '../yaml.ts'

export type OpenAPIInput = string | URL | Record<string, unknown>

export interface SourceLoaderOptions {
  cwd?: string
  /** Restrict every local source, including transitive file references, to this real directory. */
  localFileRoot?: string
  remote?: RemoteSourceOptions
  /** Retrieval URI of the document that derived this request; absent for an explicit root. */
  derivedFrom?: string
  /** Root credential origin, preserved through reference loads and redirects. */
  headerOrigin?: string
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
  headerOrigin?: string
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
  headerOrigin?: string
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
  timeoutMs: 10_000,
  maxResponseBytes: 10 * 1024 * 1024,
  maxRedirects: 5,
}
export const DEFAULT_MAX_LOCAL_SOURCE_BYTES = 64 * 1024 * 1024

export function sanitizedRemoteSource(url: URL): string {
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

/** Validate protocol and document-derived authority without DNS or address classification. */
export function validateRemoteURL(url: URL, options: RemoteSourceOptions = {}, derivedFrom?: string): Diagnostic[] {
  const source = sanitizedRemoteSource(url)
  const hostname = url.hostname.startsWith('[') && url.hostname.endsWith(']') ? url.hostname.slice(1, -1) : url.hostname
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return [{ code: 'REMOTE_SOURCE_BLOCKED', severity: 'error', message: `Remote protocol ${url.protocol} is not allowed.`, location: { source } }]
  }
  if (derivedFrom !== undefined && !isSameRemoteOrigin(new URL(derivedFrom), url) && !options.allowedHosts?.some((host) => hostMatches(hostname, host))) {
    return [{ code: 'REMOTE_SOURCE_BLOCKED', severity: 'error', message: `Derived remote host ${hostname} requires allowedHosts for cross-origin access.`, location: { source } }]
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

class RemoteSourceTooLargeError extends Error {}

/** Bound decoded response bytes even when Content-Length is absent or misleading. */
async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const length = response.headers.get('content-length')
  if (length && /^\d+$/.test(length) && BigInt(length) > BigInt(maxBytes)) {
    await response.body?.cancel()
    throw new RemoteSourceTooLargeError()
  }
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel()
        throw new RemoteSourceTooLargeError()
      }
      chunks.push(value)
    }
    return Buffer.concat(chunks, bytes)
  } finally {
    reader.releaseLock()
  }
}

async function fetchRemoteSource(initialURL: URL, options: RemoteSourceOptions, signal?: AbortSignal, headerOrigin = initialURL.origin): Promise<LoadedSource> {
  const policy = {
    ...options,
    timeoutMs: options.timeoutMs ?? defaultRemoteOptions.timeoutMs,
    maxResponseBytes: options.maxResponseBytes ?? defaultRemoteOptions.maxResponseBytes,
    maxRedirects: options.maxRedirects ?? defaultRemoteOptions.maxRedirects,
  }
  let currentURL = initialURL
  let credentialOrigin = headerOrigin
  let requestHeaders = initialURL.origin === headerOrigin ? configuredRequestHeaders(options.headers) : undefined
  for (let redirect = 0; redirect <= policy.maxRedirects; redirect += 1) {
    throwIfAborted(signal)
    const source = sanitizedRemoteSource(currentURL)
    const timeout = AbortSignal.timeout(policy.timeoutMs)
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
    try {
      const response = await fetch(currentURL, { headers: requestHeaders, signal: requestSignal, redirect: 'manual' })
      const location = response.headers.get('location')
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel()
        if (redirect === policy.maxRedirects) {
          return { source, uri: currentURL.toString(), diagnostics: [sourceDiagnostic('REMOTE_SOURCE_REDIRECT_LIMIT', 'Remote source exceeded the redirect limit.', source)] }
        }
        const nextURL = new URL(location, currentURL)
        if (isRemoteRedirectDowngrade(currentURL, nextURL)) {
          const redirectSource = sanitizedRemoteSource(nextURL)
          return { source: redirectSource, uri: nextURL.toString(), diagnostics: [sourceDiagnostic('REMOTE_SOURCE_REDIRECT_DOWNGRADE_BLOCKED', 'Remote source redirect from HTTPS to HTTP is blocked.', redirectSource)] }
        }
        const diagnostics = validateRemoteURL(nextURL, policy, currentURL.toString())
        if (diagnostics.length > 0) return { source: sanitizedRemoteSource(nextURL), uri: nextURL.toString(), diagnostics }
        if (!isSameRemoteOrigin(currentURL, nextURL)) {
          requestHeaders = undefined
          credentialOrigin = 'null'
        }
        currentURL = nextURL
        continue
      }
      if (response.status < 200 || response.status >= 300) {
        await response.body?.cancel()
        return { source, uri: currentURL.toString(), diagnostics: [sourceDiagnostic('REMOTE_SOURCE_FAILED', `Remote source returned HTTP ${response.status}.`, source)] }
      }
      const bytes = await readBoundedBody(response, policy.maxResponseBytes)
      throwIfAborted(signal)
      return {
        source,
        uri: currentURL.toString(),
        headerOrigin: credentialOrigin,
        contentType: response.headers.get('content-type') ?? undefined,
        text: Buffer.from(bytes).toString('utf8'),
        diagnostics: [],
        snapshot: contentSnapshot(source, currentURL.toString(), bytes),
      }
    } catch (error) {
      throwIfAborted(signal)
      const code = error instanceof RemoteSourceTooLargeError ? 'REMOTE_SOURCE_TOO_LARGE' : timeout.aborted ? 'REMOTE_SOURCE_TIMEOUT' : 'REMOTE_SOURCE_FAILED'
      const message = code === 'REMOTE_SOURCE_TIMEOUT' ? 'Remote source request timed out.' : code === 'REMOTE_SOURCE_TOO_LARGE' ? `Remote source exceeds the ${policy.maxResponseBytes} byte limit.` : 'Unable to load remote source.'
      // Network errors may contain URLs, credentials, headers or redirect locations.
      // Keep their details out of diagnostics, including debug mode.
      return { source, uri: currentURL.toString(), diagnostics: [sourceDiagnostic(code, message, source)] }
    }
  }
  return { source: sanitizedRemoteSource(initialURL), uri: initialURL.toString(), diagnostics: [sourceDiagnostic('REMOTE_SOURCE_REDIRECT_LIMIT', 'Remote source exceeded the redirect limit.', sanitizedRemoteSource(initialURL))] }
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
    const diagnostics = validateRemoteURL(parsedURL, options.remote, options.derivedFrom)
    if (diagnostics.length > 0) return { source: sanitizedRemoteSource(parsedURL), uri: parsedURL.toString(), diagnostics }
    // Authority is checked before any cache hit; credential-bearing and stripped loads differ.
    const sendHeaders = !options.derivedFrom || isSameRemoteOrigin(parsedURL, new URL(options.derivedFrom))
    const headerOrigin = sendHeaders ? options.headerOrigin ?? parsedURL.origin : 'null'
    const remote = sendHeaders ? options.remote ?? {} : { ...options.remote, headers: undefined }
    const key = JSON.stringify([parsedURL.toString(), headerOrigin, remoteSourcePolicyIdentity(remote)])
    const cache = options.cache ?? new Map<string, Promise<LoadedSource>>()
    const cached = cache.get(key)
    if (cached) return cached
    const pending = fetchRemoteSource(parsedURL, remote, options.signal, headerOrigin)
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
  const parsers: Array<() => unknown> = likelyJSON ? [() => JSON.parse(text), () => loadYaml(text, YAML_LOAD_OPTIONS)] : [() => loadYaml(text, YAML_LOAD_OPTIONS), () => JSON.parse(text)]
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
  return { source: source.source, uri: source.uri, headerOrigin: source.headerOrigin, originalDocument, document, version, diagnostics: sortDiagnostics(converted.diagnostics), snapshot: source.snapshot }
}
