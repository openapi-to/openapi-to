import { createServer, type Server } from 'node:http'
import { once } from 'node:events'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { compileOpenAPI } from './compiler.ts'
import { loadOpenAPIDocument } from './sourceLoader.ts'

describe('remote OpenAPI security policy', { concurrent: false }, () => {
  let server: Server
  let baseURL: string
  let previousNoProxy: string | undefined

  beforeAll(async () => {
    previousNoProxy = process.env.NO_PROXY
    process.env.NO_PROXY = '127.0.0.1,localhost'
    server = createServer((request, response) => {
      const port = (server.address() as { port: number }).port
      const pathname = new URL(request.url ?? '/', `http://127.0.0.1:${port}`).pathname
      if (pathname === '/json') {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ openapi: '3.1.0', info: { title: 'Remote JSON', version: '1' }, paths: {} }))
      } else if (pathname === '/json-as-yaml') {
        response.setHeader('content-type', 'application/yaml')
        response.end(JSON.stringify({ openapi: '3.1.0', info: { title: 'JSON body', version: '1' }, paths: {} }))
      } else if (pathname === '/json-no-content-type') {
        response.removeHeader('content-type')
        response.end(JSON.stringify({ openapi: '3.1.0', info: { title: 'JSON no type', version: '1' }, paths: {} }))
      } else if (pathname === '/yaml') {
        response.setHeader('content-type', 'application/yaml')
        response.end('openapi: 3.1.0\ninfo:\n  title: Remote YAML\n  version: "1"\npaths: {}\n')
      } else if (pathname === '/yaml-as-json') {
        response.setHeader('content-type', 'application/json')
        response.end('openapi: 3.1.0\ninfo:\n  title: YAML body\n  version: "1"\npaths: {}\n')
      } else if (pathname === '/yaml-text') {
        response.setHeader('content-type', 'text/plain')
        response.end('openapi: 3.1.0\ninfo:\n  title: YAML text\n  version: "1"\npaths: {}\n')
      } else if (pathname === '/yaml-text-type') {
        response.setHeader('content-type', 'text/yaml')
        response.end('openapi: 3.1.0\ninfo:\n  title: YAML text type\n  version: "1"\npaths: {}\n')
      } else if (pathname === '/redirect') {
        response.writeHead(302, { location: '/json' }).end()
      } else if (pathname === '/redirect-loop') {
        response.writeHead(302, { location: '/redirect-loop' }).end()
      } else if (pathname === '/redirect-private') {
        response.writeHead(302, { location: `http://localhost:${port}/json` }).end()
      } else if (pathname === '/slow') {
        setTimeout(() => response.end('openapi: 3.1.0'), 100)
      } else if (pathname === '/large') {
        response.end('x'.repeat(128))
      } else if (pathname === '/invalid-json') {
        response.setHeader('content-type', 'application/json')
        response.end('{"openapi":')
      } else if (pathname === '/invalid-yaml') {
        response.setHeader('content-type', 'application/yaml')
        response.end('openapi: [')
      } else if (pathname === '/server-error') {
        response.writeHead(500).end('internal')
      } else if (pathname === '/root.yaml') {
        response.end(`openapi: 3.1.0\ninfo:\n  title: External ref\n  version: "1"\npaths: {}\ncomponents:\n  schemas:\n    Pet:\n      $ref: http://localhost:${port}/schema.yaml#/$defs/Pet\n`)
      } else if (pathname === '/root-redirect.yaml') {
        response.end(`openapi: 3.1.0\ninfo:\n  title: External ref redirect\n  version: "1"\npaths: {}\ncomponents:\n  schemas:\n    Pet:\n      $ref: ${baseURL}/schema-redirect#/$defs/Pet\n`)
      } else if (pathname === '/root-private-redirect.yaml') {
        response.end(`openapi: 3.1.0\ninfo:\n  title: External private redirect\n  version: "1"\npaths: {}\ncomponents:\n  schemas:\n    Pet:\n      $ref: ${baseURL}/schema-private-redirect#/$defs/Pet\n`)
      } else if (pathname === '/schema-redirect') {
        response.writeHead(302, { location: '/schema.yaml' }).end()
      } else if (pathname === '/schema-private-redirect') {
        response.writeHead(302, { location: `http://localhost:${port}/schema.yaml` }).end()
      } else if (pathname === '/schema.yaml') {
        response.end('$defs:\n  Pet:\n    type: object\n')
      } else {
        response.writeHead(404).end()
      }
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    baseURL = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  })

  afterAll(async () => {
    const closed = once(server, 'close')
    server.close()
    server.closeAllConnections()
    await closed
    if (previousNoProxy === undefined) delete process.env.NO_PROXY
    else process.env.NO_PROXY = previousNoProxy
  })

  const trustedLocal = { allowPrivateNetwork: true, allowedHosts: ['127.0.0.1'] }

  it('loads JSON, YAML, and a bounded same-host redirect with explicit private-network opt-in', async () => {
    const json = await loadOpenAPIDocument(`${baseURL}/json?service=user&version=v1`, { remote: trustedLocal })
    const yaml = await loadOpenAPIDocument(`${baseURL}/yaml`, { remote: trustedLocal })
    const redirect = await loadOpenAPIDocument(`${baseURL}/redirect`, { remote: trustedLocal })
    expect(json.document?.info.title).toBe('Remote JSON')
    expect(yaml.document?.info.title).toBe('Remote YAML')
    expect(redirect.document?.info.title).toBe('Remote JSON')
  })

  it('uses response content as the final format signal across inaccurate or absent content types', async () => {
    const results = await Promise.all([
      loadOpenAPIDocument(`${baseURL}/json-as-yaml`, { remote: trustedLocal }),
      loadOpenAPIDocument(`${baseURL}/json-no-content-type`, { remote: trustedLocal }),
      loadOpenAPIDocument(`${baseURL}/yaml-as-json`, { remote: trustedLocal }),
      loadOpenAPIDocument(`${baseURL}/yaml-text`, { remote: trustedLocal }),
      loadOpenAPIDocument(`${baseURL}/yaml-text-type`, { remote: trustedLocal }),
    ])
    expect(results.map((result) => result.document?.info.title)).toEqual([
      'JSON body',
      'JSON no type',
      'YAML body',
      'YAML text',
      'YAML text type',
    ])
  })

  it('blocks private networks by default and revalidates redirect hosts', async () => {
    const blocked = await loadOpenAPIDocument(`${baseURL}/json`)
    const redirect = await loadOpenAPIDocument(`${baseURL}/redirect-private`, { remote: trustedLocal })
    expect(blocked.diagnostics[0]?.code).toBe('REMOTE_SOURCE_BLOCKED')
    expect(redirect.diagnostics[0]?.code).toBe('REMOTE_SOURCE_BLOCKED')
  })

  it('enforces timeout, maximum size, host allowlists, and secret redaction', async () => {
    const timeout = await loadOpenAPIDocument(`${baseURL}/slow`, { remote: { ...trustedLocal, timeoutMs: 10 } })
    const large = await loadOpenAPIDocument(`${baseURL.replace('http://', 'http://user:password@')}/large?token=secret`, {
      remote: { ...trustedLocal, maxResponseBytes: 16 },
    })
    const disallowed = await loadOpenAPIDocument(`${baseURL}/json`, { remote: { allowPrivateNetwork: true, allowedHosts: ['example.com'] } })
    expect(timeout.diagnostics[0]?.code).toBe('REMOTE_SOURCE_TIMEOUT')
    expect(large.diagnostics[0]?.code).toBe('REMOTE_SOURCE_TOO_LARGE')
    expect(disallowed.diagnostics[0]?.code).toBe('REMOTE_SOURCE_BLOCKED')
    expect(JSON.stringify(large.diagnostics)).not.toMatch(/password|token|secret/)
  })

  it('diagnoses redirect limits, HTTP failures, parse failures, and cancellation independently', async () => {
    const [redirectLimit, notFound, serverError, invalidJSON, invalidYAML] = await Promise.all([
      loadOpenAPIDocument(`${baseURL}/redirect-loop`, { remote: { ...trustedLocal, maxRedirects: 1 } }),
      loadOpenAPIDocument(`${baseURL}/not-found`, { remote: trustedLocal }),
      loadOpenAPIDocument(`${baseURL}/server-error`, { remote: trustedLocal }),
      loadOpenAPIDocument(`${baseURL}/invalid-json`, { remote: trustedLocal }),
      loadOpenAPIDocument(`${baseURL}/invalid-yaml`, { remote: trustedLocal }),
    ])
    expect(redirectLimit.diagnostics[0]?.code).toBe('REMOTE_SOURCE_REDIRECT_LIMIT')
    expect(notFound.diagnostics[0]).toMatchObject({ code: 'REMOTE_SOURCE_FAILED', message: 'Remote source returned HTTP 404.' })
    expect(serverError.diagnostics[0]).toMatchObject({ code: 'REMOTE_SOURCE_FAILED', message: 'Remote source returned HTTP 500.' })
    expect(invalidJSON.diagnostics[0]?.code).toBe('OPENAPI_PARSE_FAILED')
    expect(invalidYAML.diagnostics[0]?.code).toBe('OPENAPI_PARSE_FAILED')

    const controller = new AbortController()
    const pending = loadOpenAPIDocument(`${baseURL}/slow`, { remote: trustedLocal, signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'OPENAPI_OPERATION_CANCELLED' })
  })

  it('applies the same redirect and host policy to external references', async () => {
    const result = await compileOpenAPI(`${baseURL}/root.yaml`, { remote: trustedLocal })
    const allowedRedirect = await compileOpenAPI(`${baseURL}/root-redirect.yaml`, { remote: trustedLocal })
    const blockedRedirect = await compileOpenAPI(`${baseURL}/root-private-redirect.yaml`, { remote: trustedLocal })
    expect(result.success).toBe(false)
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'REMOTE_SOURCE_BLOCKED' })]))
    expect(allowedRedirect.success).toBe(true)
    expect(blockedRedirect.success).toBe(false)
    expect(blockedRedirect.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'REMOTE_SOURCE_BLOCKED' })]),
    )
  })
})
