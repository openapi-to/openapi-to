//@ts-nocheck
// biome-ignore-all lint/suspicious/noExplicitAny: This legacy hook-runner test intentionally uses a minimal structural mock.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runPluginsByTags } from './runPluginsByTags'
import type { PluginDefinition } from './types'

function createMockPlugin(name: string, hooks: Partial<PluginDefinition['hooks']> = {}): PluginDefinition {
  return {
    name,
    hooks: {
      buildStart: hooks.buildStart,
      buildEnd: hooks.buildEnd,
      tagStart: hooks.tagStart,
      tagEnd: hooks.tagEnd,
      operation: hooks.operation,
      componentsSchemas: hooks.componentsSchemas,
      componentsParameters: hooks.componentsParameters,
      componentsRequestBodies: hooks.componentsRequestBodies,
      componentsResponses: hooks.componentsResponses,
    },
  }
}

describe('runPluginsByTags', () => {
  let openAPIHelper: any
  let openAPIDocument: any
  let openapiToSingleConfig: any
  let pluginNames: any
  let context: any

  beforeEach(() => {
    openAPIHelper = {
      oas: {
        getDefinition: () => ({
          components: {},
        }),
      },
      operationsByTag: {
        tag1: [
          {
            accessor: {
              operation: {
                getTags: () => [{ name: 'tag1' }],
              },
            },
          },
        ],
      },
    }
    openAPIDocument = {}
    openapiToSingleConfig = {}
    pluginNames = ['mockPlugin']
    context = { openAPIHelper, openAPIDocument, openapiToSingleConfig, pluginNames }
  })

  it('should call all plugin hooks in order', async () => {
    const calls: string[] = []
    const plugin = createMockPlugin('mockPlugin', {
      buildStart: vi.fn(() => calls.push('buildStart')),
      tagStart: vi.fn(() => calls.push('tagStart')),
      operation: vi.fn(() => calls.push('operation')),
      tagEnd: vi.fn(() => calls.push('tagEnd')),
      buildEnd: vi.fn(() => calls.push('buildEnd')),
    })
    const result = await runPluginsByTags([[plugin]], context)
    expect(calls).toEqual(['buildStart', 'tagStart', 'operation', 'tagEnd', 'buildEnd'])
    expect(result.failedPluginNames).toEqual([])
    expect(Array.isArray(result.sourceFiles)).toBe(true)
  })

  it('should collect failed plugin names if a hook throws', async () => {
    const plugin = createMockPlugin('failPlugin', {
      buildStart: vi.fn(() => {
        throw new Error('fail')
      }),
    })
    await expect(runPluginsByTags([[plugin]], context)).resolves.toMatchObject({
      failedPluginNames: ['failPlugin'],
    })
  })

  it('should handle multiple stages and plugins', async () => {
    const calls: string[] = []
    const plugin1 = createMockPlugin('p1', { buildStart: vi.fn(() => calls.push('p1')) })
    const plugin2 = createMockPlugin('p2', { buildStart: vi.fn(() => calls.push('p2')) })
    await runPluginsByTags([[plugin1], [plugin2]], context)
    expect(calls).toEqual(['p1', 'p2'])
  })

  it('runs untagged operations through the stable default tag', async () => {
    openAPIHelper.operationsByTag = {
      default: [{ accessor: { operation: { getTags: () => [] } } }],
    }
    const tagNames: string[] = []
    const operations: string[] = []
    const plugin = createMockPlugin('untagged', {
      tagStart: vi.fn((tag) => tagNames.push(tag.name)),
      operation: vi.fn(() => operations.push('operation')),
    })
    await runPluginsByTags([[plugin]], context)
    expect(tagNames).toEqual(['default'])
    expect(operations).toEqual(['operation'])
  })

  it('looks up generated source files by array value and replaces an equal key', async () => {
    const first = { id: 'first' }
    const replacement = { id: 'replacement' }
    let retrieved: any
    const producer = createMockPlugin('producer', {
      tagStart: (_tag, ctx) => {
        ctx.setSourceFiles(['plugin', 'componentsSchemas', 'Pet'], first as any)
        ctx.setSourceFiles(['plugin', 'componentsSchemas', 'Pet'], replacement as any)
      },
    })
    const consumer = createMockPlugin('consumer', {
      tagStart: (_tag, ctx) => {
        retrieved = ctx.getSourceFiles(['plugin', 'componentsSchemas', 'Pet'])
      },
    })

    await runPluginsByTags([[producer], [consumer]], context)

    expect(retrieved).toBe(replacement)
  })
})
