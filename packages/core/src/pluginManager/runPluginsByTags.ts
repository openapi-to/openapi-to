import { camelCase, find, isEmpty } from 'lodash-es'
import type { OpenAPIV3, OpenAPIV3_1 } from 'openapi-types'
import type { SourceFile } from 'ts-morph'
import type { Diagnostic } from '../diagnostics.ts'
import type { GeneratedArtifact } from '../artifacts/types.ts'
import type { OpenAPIHelper } from '../OpenAPIContext/OpenAPIHelper.ts'
import type { HookTagObject } from '../OpenAPIContext/types.ts'
import type { PluginEnumType } from '../enums.ts'
import type { ComponentHookType, OpenAPIDocument, OpenapiToSingleConfig } from '../types'
import type { HookContext, PluginDefinition } from './types.ts'
import { isOpenapiOperationCancelled, throwIfAborted } from '../execution.ts'
import { classifyOpenAPIDialect } from '../openapi/dialect.ts'

type Context = {
  openAPIHelper: OpenAPIHelper
  openAPIDocument: OpenAPIDocument
  openapiToSingleConfig: OpenapiToSingleConfig
  pluginNames: PluginEnumType
  signal?: AbortSignal
}

type ComponentHookData = NonNullable<ComponentHookType['data']>

export async function runPluginsByTags(
  stages: PluginDefinition[][],
  { openAPIHelper, openAPIDocument, openapiToSingleConfig, pluginNames, signal }: Context,
): Promise<{ failedPluginNames: string[]; sourceFiles: SourceFile[]; artifacts: GeneratedArtifact[]; diagnostics: Diagnostic[] }> {
  const failedPluginNamesSet = new Set<string>() // 收集失败的插件名称
  const diagnostics: Diagnostic[] = []

  const ctx: HookContext = {
    signal,
    _tagSourceFiles: new Map<string[], SourceFile>(),
    openapiHelper: openAPIHelper,
    openapiToSingleConfig: openapiToSingleConfig,
    openAPIDocument: openAPIDocument,
    openAPIDialect: classifyOpenAPIDialect(openAPIDocument.openapi),
    pluginNames: pluginNames,
    getSourceFiles(name: string[]) {
      return ctx._tagSourceFiles.get(name)
    },
    setSourceFiles(name: string[], sourceFile: SourceFile) {
      ctx._tagSourceFiles.set(name, sourceFile)
    },
    artifacts: [],
    diagnostics,
    addArtifact(artifact) {
      ctx.artifacts.push(artifact)
    },
    addDiagnostic(diagnostic) {
      diagnostics.push(diagnostic)
    },
    store: new Map(),
    /*    clearSourceFiles() {
      ctx._tagSourceFiles.clear()
    },*/
  }

  const operationNameSources = new Map<string, Map<string, Array<string | number>>>()
  for (const [tagName, operations] of Object.entries(openAPIHelper.operationsByTag)) {
    for (const operation of operations) {
      const key = `${tagName}\0${operation.accessor.operationName}`
      const sources = operationNameSources.get(key) ?? new Map<string, Array<string | number>>()
      sources.set(operation.sourcePointer, operation.sourcePath)
      operationNameSources.set(key, sources)
    }
  }
  const operationNameCollisions = new Set(
    [...operationNameSources].filter(([, sources]) => sources.size > 1).map(([key]) => key),
  )
  for (const key of [...operationNameCollisions].sort()) {
    const [tagName = '', operationName = ''] = key.split('\0')
    diagnostics.push({
      code: 'OPERATION_GENERATED_NAME_COLLISION',
      severity: 'error',
      message: `Operations in tag ${tagName} normalize to the same generated name ${operationName}.`,
      location: { path: [...(operationNameSources.get(key)?.values().next().value ?? [])] },
      hint: `Conflicting sources: ${[...(operationNameSources.get(key)?.keys() ?? [])].sort().join(', ')}.`,
    })
  }

  // let currentSourceFiles: SourceFile[] = []

  // 按顺序执行每个stage
  for (const stage of stages) {
    throwIfAborted(signal)
    try {
      // 1. 先顺序执行 buildStart 和 tagStart
      await executePluginHooks(stage, 'buildStart', (plugin) => plugin.hooks.buildStart?.(ctx), failedPluginNamesSet, diagnostics, signal)

      // 2. 并发执行组件钩子和操作
      const components = openAPIHelper.oas.getDefinition().components
      if (!isEmpty(components)) await executePluginComponents(stage, ctx, components, failedPluginNamesSet, diagnostics, signal)
      const concurrentTagStartTasks = []
      const concurrentTagOperationsTasks = []
      const concurrentTagTagEndTasks = []
      //
      for (const tagName in openAPIHelper.operationsByTag) {
        throwIfAborted(signal)
        const operations = openAPIHelper.operationsByTag[tagName]
        const firstOperation = operations?.[0]
        if (!operations || !firstOperation) continue
        const matchedTag = find(firstOperation.accessor.operation.getTags(), (tag) => camelCase(tag.name) === tagName)
        if (!matchedTag && tagName !== 'default') {
          throw new Error(`Tag with name "${tagName}" not found`)
        }
        const tagData: HookTagObject = matchedTag ? { ...matchedTag } : { name: 'default' }
        concurrentTagStartTasks.push(await executePluginHooks(stage, 'tagStart', (plugin) => plugin.hooks.tagStart?.(tagData, ctx), failedPluginNamesSet, diagnostics, signal))

        // 添加操作钩子并发任务（所有操作并发执行）
        const operationsTask = Promise.all(
          operations
            .filter((operation) => !operationNameCollisions.has(`${tagName}\0${operation.accessor.operationName}`))
            .map((operation) => executePluginHooks(stage, 'operation', (plugin) => plugin.hooks.operation?.(operation, ctx), failedPluginNamesSet, diagnostics, signal)),
        )
        concurrentTagOperationsTasks.push(operationsTask)

        concurrentTagTagEndTasks.push(await executePluginHooks(stage, 'tagEnd', (plugin) => plugin.hooks.tagEnd?.(tagData, ctx), failedPluginNamesSet, diagnostics, signal))
      }

      // 并发执行所有任务
      await Promise.all(concurrentTagStartTasks)
      await Promise.all(concurrentTagOperationsTasks)
      await Promise.all(concurrentTagTagEndTasks)

      // 3. 最后顺序执行buildEnd

      await executePluginHooks(stage, 'buildEnd', (plugin) => plugin.hooks.buildEnd?.(ctx), failedPluginNamesSet, diagnostics, signal)
    } catch (error) {
      if (isOpenapiOperationCancelled(error)) throw error
      diagnostics.push({ code: 'PLUGIN_EXECUTION_FAILED', severity: 'error', message: `Plugin stage failed: ${error instanceof Error ? error.message : String(error)}`, cause: error instanceof Error ? error.message : undefined })
      throw error
    }
  }

  return {
    sourceFiles: [...ctx._tagSourceFiles.values()].flat(),
    artifacts: ctx.artifacts,
    diagnostics,
    failedPluginNames: [...failedPluginNamesSet],
  }
}

/**
 * 通用钩子执行器，遍历插件并执行指定的钩子函数
 */
async function executePluginHooks(
  plugins: PluginDefinition[],
  hookName: string,
  hookExecutor: (plugin: PluginDefinition) => unknown | Promise<unknown>,
  failedPluginNames: Set<string>,
  diagnostics: Diagnostic[],
  signal?: AbortSignal,
) {
  for (const plugin of plugins) {
    throwIfAborted(signal)
    try {
      await hookExecutor(plugin)
      throwIfAborted(signal)
    } catch (error) {
      if (isOpenapiOperationCancelled(error)) throw error
      diagnostics.push({
        code: 'PLUGIN_EXECUTION_FAILED',
        severity: 'error',
        message: `Plugin ${plugin.name} hook ${hookName} failed: ${error instanceof Error ? error.message : String(error)}`,
        plugin: plugin.name,
        cause: error instanceof Error ? error.message : undefined,
      })
      failedPluginNames.add(plugin.name)
    }
  }
}

async function executePluginComponents(
  stage: PluginDefinition[],
  ctx: HookContext,
  components: OpenAPIV3.ComponentsObject | OpenAPIV3_1.ComponentsObject,
  failedPluginNames: Set<string>,
  diagnostics: Diagnostic[],
  signal?: AbortSignal,
) {
  // 准备组件钩子任务
  const componentHooks: ComponentHookType[] = [
    { type: 'componentsSchemas', data: components.schemas },
    { type: 'componentsParameters', data: components.parameters },
    { type: 'componentsRequestBodies', data: components.requestBodies },
    { type: 'componentsResponses', data: components.responses },
  ]

  return Promise.all(
    componentHooks
      .filter(({ data }) => !isEmpty(data))
      .map(({ type, data }) =>
        executePluginHooks(
          stage,
          type,
          (plugin) => {
            const hookFn = plugin.hooks[type] as ((hookData: ComponentHookData, hookContext: HookContext) => Promise<void> | void) | undefined
            return hookFn?.(data as ComponentHookData, ctx)
          },
          failedPluginNames,
          diagnostics,
          signal,
        ),
      )
      .filter(Boolean),
  )
}
