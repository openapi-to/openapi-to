import type { SourceFile } from 'ts-morph'
import type { Diagnostic } from '../diagnostics.ts'
import type { GeneratedArtifact } from '../artifacts/types.ts'
import type { OpenAPIHelper } from '../OpenAPIContext/OpenAPIHelper.ts'
import type { OpenAPIDialect } from '../openapi/dialect.ts'

import type { ComponentsParameters, ComponentsRequestBodies, ComponentsResponses, HookTagObject, OperationWrapper, Schema } from '../OpenAPIContext/types.ts'
import type { PluginEnumType } from '../enums.ts'
import type { OpenAPIDocument, OpenapiToSingleConfig } from '../types'

export type PluginName = {
  name: string
}

export type PluginContext = {
  tsRequest?: SourceFile[]
  tsType?: SourceFile[]
  zod?: SourceFile[]
}

export type WriteFile = Array<{
  filePath: string
  fileText: string
}>

export type PluginConfigFactory<T> = (pluginConfig?: T) => PluginDefinition

export interface HookContext extends PluginContext {
  /** Invocation-scoped cancellation signal. Plugins should check it in long-running hooks. */
  signal?: AbortSignal
  _tagSourceFiles: Map<(string | undefined)[], SourceFile>
  getSourceFiles: (name: string[]) => SourceFile | undefined
  setSourceFiles: (name: string[], files: SourceFile) => void
  /** Add a non-ts-morph artifact without affecting the legacy SourceFile API. */
  addArtifact: (artifact: GeneratedArtifact) => void
  /** Contribute a machine-readable diagnostic from a plugin hook. */
  addDiagnostic: (diagnostic: Diagnostic) => void
  artifacts: GeneratedArtifact[]
  diagnostics: Diagnostic[]
  openapiHelper: OpenAPIHelper
  pluginNames: PluginEnumType
  openAPIDocument: OpenAPIDocument
  /** Dialect from the source document's preserved `openapi` field. */
  openAPIDialect: OpenAPIDialect
  openapiToSingleConfig: OpenapiToSingleConfig
  // biome-ignore lint/suspicious/noExplicitAny: Preserve the legacy plugin store's intentionally open value contract.
  store: Map<any, any>
}
export type ComponentsSchemas = Record<string, Schema>

export type ComponentHooks = {
  componentsSchemas?(schemas: ComponentsSchemas, hookContext: HookContext): Promise<void> | void
  componentsParameters?(parameters: ComponentsParameters, hookContext: HookContext): Promise<void> | void
  componentsRequestBodies?(requestBodies: ComponentsRequestBodies, hookContext: HookContext): Promise<void> | void
  componentsResponses?(responses: ComponentsResponses, hookContext: HookContext): Promise<void> | void
}

export type ComponentHookType =
  | { type: 'componentsSchemas'; data: ComponentsSchemas | undefined }
  | { type: 'componentsParameters'; data: ComponentsParameters | undefined }
  | { type: 'componentsRequestBodies'; data: ComponentsRequestBodies | undefined }
  | { type: 'componentsResponses'; data: ComponentsResponses | undefined }

export type PluginDefinition = {
  name: string
  dependencies?: PluginEnumType
  hooks: {
    buildStart?(hookContext: HookContext): Promise<void> | void
    tagStart?(tagData: HookTagObject, hookContext: HookContext): Promise<void> | void
    operation?(operation: OperationWrapper, hookContext: HookContext): Promise<void> | void
    tagEnd?(tagData: HookTagObject, hookContext: HookContext): Promise<void> | void
    componentsSchemas?(schemas: ComponentsSchemas, hookContext: HookContext): Promise<void> | void
    componentsParameters?(parameters: ComponentsParameters, hookContext: HookContext): Promise<void> | void
    componentsRequestBodies?(requestBodies: ComponentsRequestBodies, hookContext: HookContext): Promise<void> | void
    componentsResponses?(responses: ComponentsResponses, hookContext: HookContext): Promise<void> | void
    buildEnd?(hookContext: HookContext): Promise<void> | void
  }
}
