import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getEventListeners } from 'node:events'
import { describe, expect, it } from 'vitest'

import { GenerationLock } from '../generation/generation-lock.ts'
import { TrustedConfigProvider } from '../generation/trusted-config.ts'
import type { McpLogger } from '../logger.ts'
import { resolveMcpServerOptions } from '../options.ts'
import { diffTool } from './diff.ts'
import { openapiGenerateTool } from './generate.ts'
import { inspectTool } from './inspect.ts'
import type { ToolContext } from './context.ts'
import { validateTool } from './validate.ts'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const logger: McpLogger = { debug() {}, info() {}, warn() {}, error() {} }

function context(workspaceRoot: string, configPath?: string): ToolContext {
  const options = resolveMcpServerOptions({ workspaceRoot, configPath, limits: { maxChanges: 1, maxArtifacts: 1, maxPreviewBytes: 5 } })
	return { options, generationMode: options.generationMode, logger, trustedConfig: new TrustedConfigProvider(options.workspaceRoot, configPath), generationLock: new GenerationLock() }
}

describe('MCP bounded tool results', () => {
  it('prioritizes breaking diff changes and truncates inspection operations deterministically', async () => {
    const result = await diffTool(context(repositoryRoot), {
      before: 'packages/mcp/src/fixtures/valid.yaml',
      after: 'packages/mcp/src/fixtures/after.yaml',
    })
    const structured = result.structuredContent as Record<string, unknown>
    expect(structured.truncated).toMatchObject({ changes: true, returnedChanges: 1 })
    expect(structured.changes).toEqual([expect.objectContaining({ classification: 'breaking' })])
    expect((structured.diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('MCP_RESULT_TRUNCATED')

    const root = await mkdtemp(path.join(os.tmpdir(), 'mcp-operation-limit-'))
    await writeFile(
      path.join(root, 'many.yaml'),
      'openapi: 3.1.0\ninfo: { title: Many, version: "1" }\npaths:\n  /a: { get: { responses: { "200": { description: ok } } } }\n  /b: { post: { responses: { "200": { description: ok } } } }\n',
    )
    const inspected = await inspectTool(context(root), { source: 'many.yaml', includeOperations: true })
    expect((inspected.structuredContent as Record<string, unknown>).truncated).toMatchObject({ operations: true, totalOperations: 2, returnedOperations: 1 })
    expect(((inspected.structuredContent as Record<string, unknown>).inspection as { missingOperationIds: string[] }).missingOperationIds).toHaveLength(2)
  })

  it('applies one artifact budget across generation output and bounds previews', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'mcp-artifact-limit-'))
    await mkdir(path.join(root, '.openapi-to'))
    await writeFile(path.join(root, 'openapi.yaml'), 'openapi: 3.1.0\ninfo: { title: Limits, version: "1" }\npaths: {}\n')
    await writeFile(
      path.join(root, 'openapi.config.js'),
      `module.exports = { servers: [{ name: 'main', input: { path: './openapi.yaml' }, output: { dir: 'generated' } }], plugins: [{ name: 'limits', hooks: { buildStart(ctx) { for (const name of ['a', 'b', 'c']) ctx.addArtifact({ kind: 'text', path: ctx.openapiToSingleConfig.output.dir + '/' + name + '.txt', content: '0123456789' }) } } }] }\n`,
    )
    const progress: number[] = []
	const result = await openapiGenerateTool(
		context(root, 'openapi.config.js'),
		{ target: 'main', selection: { type: 'full' }, includePreview: true, mode: 'dry-run' },
      { signal: new AbortController().signal, _meta: { progressToken: 'test' }, sendNotification: async (notification) => { progress.push(notification.params.progress) } },
    )
    const structured = result.structuredContent as Record<string, unknown>
    expect(structured.truncated).toMatchObject({ artifacts: true, totalArtifacts: 3, returnedArtifacts: 1, previews: true })
    expect((structured.diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('MCP_RESULT_TRUNCATED')
    expect(progress).toEqual([...progress].sort((left, right) => left - right))
    expect(progress.at(-1)).toBe(100)
  })

  it('returns a stable cancellation diagnostic at the execution boundary', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await validateTool(
      context(repositoryRoot),
      { source: 'packages/mcp/src/fixtures/valid.yaml' },
      { signal: controller.signal, sendNotification: async () => undefined },
    )
    expect(result.isError).toBe(true)
    expect((result.structuredContent.diagnostics as Array<{ code: string }>).map(({ code }) => code)).toContain('MCP_REQUEST_CANCELLED')
  })

  it('removes request abort listeners after a successful call', async () => {
    const controller = new AbortController()
    const result = await validateTool(
      context(repositoryRoot),
      { source: 'packages/mcp/src/fixtures/valid.yaml' },
      { signal: controller.signal, sendNotification: async () => undefined },
    )
    expect(result.isError).not.toBe(true)
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
  })
})
