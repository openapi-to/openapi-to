import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import axios from 'axios'
import { describe, expect, it, vi } from 'vitest'
import { compileOpenAPI } from './compiler.ts'
import { isPrivateIPAddress, loadOpenAPIDocument, loadSource, parseOpenAPISource, validateRemoteURL } from './sourceLoader.ts'

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

  it('accepts an object input', async () => {
    const result = await compileOpenAPI({ openapi: '3.1.0', info: { title: 'Object', version: '1' }, paths: {} })
    expect(result.success).toBe(true)
  })

  it('blocks private and local addresses by default', async () => {
    expect(isPrivateIPAddress('127.0.0.1')).toBe(true)
    expect(isPrivateIPAddress('169.254.169.254')).toBe(true)
    expect(isPrivateIPAddress('::1')).toBe(true)
    expect(isPrivateIPAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isPrivateIPAddress('::ffff:7f00:1')).toBe(true)
    expect((await validateRemoteURL(new URL('http://127.0.0.1/openapi.yaml')))[0]?.code).toBe('REMOTE_SOURCE_BLOCKED')
    expect((await validateRemoteURL(new URL('http://2130706433/openapi.yaml')))[0]?.code).toBe('REMOTE_SOURCE_BLOCKED')
    expect((await validateRemoteURL(new URL('http://[::1]/openapi.yaml')))[0]?.code).toBe('REMOTE_SOURCE_BLOCKED')
    expect((await validateRemoteURL(new URL('file:///etc/passwd')))[0]?.code).toBe('REMOTE_SOURCE_BLOCKED')
  })

  it('accepts trusted HTTPS responses and parses by content rather than the URL suffix', async () => {
    const request = vi.spyOn(axios, 'get').mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'text/plain' },
      data: 'openapi: 3.1.0\ninfo: { title: HTTPS YAML, version: "1" }\npaths: {}\n',
    } as never)
    const result = await loadOpenAPIDocument('https://127.0.0.1/openapi?service=user', {
      remote: { allowPrivateNetwork: true },
    })
    expect(result.document?.info.title).toBe('HTTPS YAML')
    expect(request).toHaveBeenCalledTimes(1)
    vi.restoreAllMocks()
  })

  it('treats a null remote content type as absent', async () => {
    const request = vi.spyOn(axios, 'get').mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': null },
      data: '{"openapi":"3.1.0","info":{"title":"No type","version":"1"},"paths":{}}',
    } as never)
    const result = await loadSource('https://127.0.0.1/openapi', {
      remote: { allowPrivateNetwork: true },
    })
    expect(result.contentType).toBeUndefined()
    expect(request).toHaveBeenCalledTimes(1)
    vi.restoreAllMocks()
  })

  it('rejects oversized remote responses without exposing query parameters', async () => {
    vi.spyOn(axios, 'get').mockResolvedValueOnce({ status: 200, headers: { 'content-type': 'application/json' }, data: 'x'.repeat(20) } as never)
    const result = await loadOpenAPIDocument('http://127.0.0.1/openapi.json?token=secret', { remote: { allowPrivateNetwork: true, maxResponseBytes: 10 } })
    expect(result.diagnostics[0]?.code).toBe('REMOTE_SOURCE_TOO_LARGE')
    expect(JSON.stringify(result.diagnostics)).not.toContain('secret')
    vi.restoreAllMocks()
  })

  it('revalidates every redirect target', async () => {
    const request = vi.spyOn(axios, 'get').mockResolvedValueOnce({ status: 302, headers: { location: 'http://127.0.0.1/private.yaml' }, data: '' } as never)
    const result = await loadOpenAPIDocument('http://8.8.8.8/openapi.yaml')
    expect(request).toHaveBeenCalledTimes(1)
    expect(result.diagnostics[0]?.code).toBe('REMOTE_SOURCE_BLOCKED')
    vi.restoreAllMocks()
  })

  it('blocks HTTPS to HTTP redirect downgrades before a second request', async () => {
    const request = vi.spyOn(axios, 'get').mockResolvedValueOnce({
      status: 302,
      headers: { location: 'http://127.0.0.1/plaintext.yaml' },
      data: '',
    } as never)
    const result = await loadOpenAPIDocument('https://127.0.0.1/openapi.yaml', {
      remote: { allowPrivateNetwork: true },
    })
    expect(request).toHaveBeenCalledTimes(1)
    expect(result.diagnostics[0]?.code).toBe('REMOTE_SOURCE_REDIRECT_DOWNGRADE_BLOCKED')
    vi.restoreAllMocks()
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
