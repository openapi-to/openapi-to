import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { compileOpenAPI } from './compiler.ts'
import { loadOpenAPIDocument, loadSource, parseOpenAPISource, validateRemoteURL } from './sourceLoader.ts'

const fixtureRoot = path.dirname(fileURLToPath(import.meta.url))

describe('OpenAPI source loader', () => {
  it('loads JSON and YAML based on content', async () => {
    const json = await loadOpenAPIDocument(path.resolve(fixtureRoot, '../../mock/openapiV3.json'))
    const yaml = await loadOpenAPIDocument(path.resolve(fixtureRoot, 'fixtures/openapi-3.2.yaml'))
    expect(json.document?.openapi).toMatch(/^3\.0\./)
    expect(yaml.document?.openapi).toBe('3.2.0')
  })

  it('preserves YAML anchors and merges without allowing prototype pollution', () => {
    const result = parseOpenAPISource({
      source: 'security.yaml',
      uri: 'file:///security.yaml',
      text: [
        'infoDefaults: &infoDefaults',
        '  title: Anchored API',
        '  version: "1"',
        'openapi: 3.1.0',
        'info:',
        '  <<: *infoDefaults',
        'paths: {}',
        'x-payload:',
        '  <<:',
        '    __proto__: &polluting',
        '      polluted: true',
      ].join('\n'),
      diagnostics: [],
    })

    expect(result.diagnostics).toEqual([])
    expect(result.value?.info).toEqual({ title: 'Anchored API', version: '1' })
    const payload = result.value?.['x-payload'] as Record<string, unknown>
    expect(Object.hasOwn(payload, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(payload)).toBe(Object.prototype)
    expect(payload.polluted).toBeUndefined()
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined()
  })

  it('rejects adversarial YAML merge chains that exceed the parser work bound', () => {
    const mappings = Array.from({ length: 150 }, (_, index) => {
      if (index === 0) return 'merge0: &merge0\n  key0: 0'
      return `merge${index}: &merge${index}\n  <<: *merge${index - 1}\n  key${index}: ${index}`
    })
    const result = parseOpenAPISource({
      source: 'adversarial.yaml',
      uri: 'file:///adversarial.yaml',
      text: ['openapi: 3.1.0', 'info: { title: Bounded, version: "1" }', 'paths: {}', ...mappings].join('\n'),
      diagnostics: [],
    })

    expect(result.value).toBeUndefined()
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'OPENAPI_PARSE_FAILED',
        message: 'Unable to parse OpenAPI document as JSON or YAML.',
      }),
    ])
  })

  it('rejects empty YAML and complex mapping keys with bounded diagnostics', () => {
    const empty = parseOpenAPISource({ source: 'empty.yaml', uri: 'file:///empty.yaml', text: '', diagnostics: [] })
    expect(empty.value).toBeUndefined()
    expect(empty.diagnostics).toEqual([
      expect.objectContaining({
        code: 'OPENAPI_PARSE_FAILED',
        message: 'Unable to parse OpenAPI document as JSON or YAML.',
      }),
    ])

    const complexKey = parseOpenAPISource({
      source: 'complex-key.yaml',
      uri: 'file:///complex-key.yaml',
      text: ['openapi: 3.1.0', 'info: { title: Complex key, version: "1" }', 'paths: {}', 'x-complex:', '  ? [one, two]', '  : value'].join('\n'),
      diagnostics: [],
    })
    expect(complexKey.value).toBeUndefined()
    expect(complexKey.diagnostics).toEqual([
      expect.objectContaining({
        code: 'OPENAPI_PARSE_FAILED',
        message: 'Unable to parse OpenAPI document as JSON or YAML.',
      }),
    ])
  })

  it('rejects YAML alias expansion that exceeds the parser work bound', () => {
    const result = parseOpenAPISource({
      source: 'aliases.yaml',
      uri: 'file:///aliases.yaml',
      text: [
        'openapi: 3.1.0',
        'info: { title: Aliases, version: "1" }',
        'paths: {}',
        'base: &base { value: 1 }',
        'aliases:',
        ...Array.from({ length: 101 }, () => '  - *base'),
      ].join('\n'),
      diagnostics: [],
    })

    expect(result.value).toBeUndefined()
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'OPENAPI_PARSE_FAILED',
        message: 'Unable to parse OpenAPI document as JSON or YAML.',
      }),
    ])
  })

  it('accepts an object input', async () => {
    const result = await compileOpenAPI({ openapi: '3.1.0', info: { title: 'Object', version: '1' }, paths: {} })
    expect(result.success).toBe(true)
  })

  it('checks HTTP(S) protocol and derived origin authority, independently of address classes', () => {
    expect(validateRemoteURL(new URL('http://127.0.0.1/openapi.yaml'), { allowedHosts: ['other.test'] })).toEqual([])
    expect(validateRemoteURL(new URL('file:///etc/passwd'))[0]?.code).toBe('REMOTE_SOURCE_BLOCKED')
    expect(validateRemoteURL(new URL('https://a.test/schema'), {}, 'https://a.test/root')).toEqual([])
    expect(validateRemoteURL(new URL('https://b.test/schema'), {}, 'https://a.test/root')[0]?.code).toBe('REMOTE_SOURCE_BLOCKED')
    expect(validateRemoteURL(new URL('https://b.test/schema'), { allowedHosts: ['*.test'] }, 'file:///root.yaml')).toEqual([])
    expect(validateRemoteURL(new URL('https://test/schema'), { allowedHosts: ['*.test'] }, 'file:///root.yaml')[0]?.code).toBe('REMOTE_SOURCE_BLOCKED')
  })

  it('accepts explicit HTTPS roots and uses content rather than the URL suffix', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('openapi: 3.1.0\ninfo: { title: HTTPS YAML, version: "1" }\npaths: {}\n', { headers: { 'content-type': 'text/plain' } }))
    try {
      const result = await loadOpenAPIDocument('https://api.example.com/openapi?service=user')
      expect(result.document?.info.title).toBe('HTTPS YAML')
      expect(request).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ redirect: 'manual', signal: expect.any(AbortSignal) }))
    } finally { vi.restoreAllMocks() }
  })

  it('treats an absent remote content type as absent', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(new Uint8Array(Buffer.from('{}'))))
    try {
      expect((await loadSource('https://api.example.com/openapi')).contentType).toBeUndefined()
    } finally { vi.restoreAllMocks() }
  })

  it('blocks HTTPS to HTTP downgrades before another request', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/plaintext.yaml' } }))
    try {
      const result = await loadOpenAPIDocument('https://api.example.com/openapi.yaml', { remote: { allowedHosts: ['127.0.0.1'] } })
      expect(request).toHaveBeenCalledTimes(1)
      expect(result.diagnostics[0]?.code).toBe('REMOTE_SOURCE_REDIRECT_DOWNGRADE_BLOCKED')
    } finally { vi.restoreAllMocks() }
  })

  it('omits raw network error details even in debug mode', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Authorization: Bearer secret; http://user:password@other.test/?token=secret'))
    try {
      const result = await loadSource('https://user:password@api.example.com/openapi?token=secret', { debug: true, remote: { headers: { Authorization: 'Bearer secret' } } })
      expect(result.diagnostics[0]?.code).toBe('REMOTE_SOURCE_FAILED')
      expect(JSON.stringify(result.diagnostics)).not.toMatch(/password|token|secret|Authorization/)
    } finally { vi.restoreAllMocks() }
  })

  it('honors pre-aborted calls and local input size boundaries', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(loadOpenAPIDocument({ openapi: '3.1.0' }, { signal: controller.signal })).rejects.toMatchObject({ code: 'OPENAPI_OPERATION_CANCELLED' })
    const root = await mkdtemp(path.join(os.tmpdir(), 'openapi-source-limit-'))
    const file = path.join(root, 'large.json')
    await writeFile(file, '{}')
    const result = await loadSource(file, { maxSourceBytes: 1 })
    expect(result.diagnostics[0]?.code).toBe('LOCAL_SOURCE_TOO_LARGE')
    await rm(root, { recursive: true, force: true })
  })

  it('fails closed when local source metadata changes during a large read', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'openapi-source-race-'))
    const file = path.join(root, 'changing.json')
    await writeFile(file, `{"openapi":"3.1.0","padding":"${'x'.repeat(8 * 1024 * 1024)}"}`)
    const timer = setInterval(() => { void utimes(file, new Date(), new Date()) }, 1)
    const result = await loadSource(file, { maxSourceBytes: 16 * 1024 * 1024 })
    clearInterval(timer)
    expect(result.diagnostics[0]?.code).toBe('LOCAL_SOURCE_CHANGED_DURING_READ')
    await rm(root, { recursive: true, force: true })
  })
})
