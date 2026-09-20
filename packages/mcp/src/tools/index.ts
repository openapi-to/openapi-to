import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { z } from 'zod'

import { checkGenerationInputSchema, checkGenerationOutputSchema, checkGenerationTool } from './check-generation.ts'
import { applyGenerationInputSchema, applyGenerationOutputSchema, applyGenerationTool } from './apply-generation.ts'
import type { McpHandlerExtra, ToolContext } from './context.ts'
import { diffInputSchema, diffOutputSchema, diffTool } from './diff.ts'
import { generateInputSchemaForMode, openapiGenerateOutputSchema, openapiGenerateTool } from './generate.ts'
import { inspectInputSchema, inspectOutputSchema, inspectTool } from './inspect.ts'
import { prepareGenerationInputSchema, prepareGenerationOutputSchema, prepareGenerationTool } from './prepare-generation.ts'
import { validateInputSchema, validateOutputSchema, validateTool } from './validate.ts'
import { getOperationInputSchema, getOperationOutputSchema, getOperationTool } from './get-operation.ts'
import { listTargetsInputSchema, listTargetsOutputSchema, listTargetsTool } from './list-targets.ts'
import { searchOperationsInputSchema, searchOperationsOutputSchema, searchOperationsTool } from './search-operations.ts'

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const

const TRUSTED_CONFIG_READ_ONLY_ANNOTATIONS = { ...READ_ONLY_ANNOTATIONS, openWorldHint: false } as const

export function registerReadOnlyTools(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'openapi_validate',
    {
      title: 'Validate OpenAPI',
      description: 'Use when the question is whether one OpenAPI document is valid or why parsing, references, or validation failed. Does not summarize API shape, compare versions, generate code, or modify files. Parser acceptance does not imply every generator supports every construct; OpenAPI 3.2 is compatible-read with diagnosed generation gaps.',
      inputSchema: validateInputSchema,
      outputSchema: validateOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input, extra) => validateTool(context, input, extra),
  )
  server.registerTool(
    'openapi_inspect',
    {
      title: 'Inspect OpenAPI',
      description: 'Use for counts, operations, tags, missing operationIds, security schemes, and compatibility classification of one OpenAPI document. This is structural inspection, not validation or version comparison. Returns a bounded summary, never the full document, and modifies no files.',
      inputSchema: inspectInputSchema,
      outputSchema: inspectOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input, extra) => inspectTool(context, input, extra),
  )
  server.registerTool(
    'openapi_diff',
    {
      title: 'Compare OpenAPI Documents',
      description: 'Use only to compare a before and after OpenAPI document for first-stage breaking, non-breaking, and warning changes. This is not validation, generation freshness, a complete compatibility proof, or a breaking-change oracle. Modifies no files.',
      inputSchema: diffInputSchema,
      outputSchema: diffOutputSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (input, extra) => diffTool(context, input, extra),
  )
  if (!context.trustedConfig.configured) return
  server.registerTool(
    'openapi_list_targets',
    {
      title: 'List Trusted OpenAPI Targets',
      description: 'Use before operation search when the startup-trusted configuration has multiple targets. Returns only target names, local/remote source type, bounded counts, generation availability, and diagnostic summaries. Never returns source locations, URLs, headers, secrets, configuration bodies, or OpenAPI documents.',
      inputSchema: listTargetsInputSchema,
      outputSchema: listTargetsOutputSchema,
      annotations: TRUSTED_CONFIG_READ_ONLY_ANNOTATIONS,
    },
    (input, extra) => listTargetsTool(context, input, extra),
  )
  server.registerTool(
    'openapi_search_operations',
    {
      title: 'Search Trusted OpenAPI Operations',
      description: 'Use to find a small ranked set of operations in one startup-trusted target by operation identity, method/path, tags, parameters, schema names, summary, or description. Returns lightweight summaries only; never returns a full OpenAPI document, full operation object, or schema body, and never generates or writes files.',
      inputSchema: searchOperationsInputSchema,
      outputSchema: searchOperationsOutputSchema,
      annotations: TRUSTED_CONFIG_READ_ONLY_ANNOTATIONS,
    },
    (input, extra) => searchOperationsTool(context, input, extra),
  )
  server.registerTool(
    'openapi_get_operation',
    {
      title: 'Read Trusted OpenAPI Operation Contract',
      description: 'Use after openapi_search_operations to read one selected operation by stable operationKey. Returns summary or a bounded request/response contract with depth-, count-, property-, example-, and byte-limited related schema summaries. Never returns the full OpenAPI document or components.schemas and never generates or writes files.',
      inputSchema: getOperationInputSchema,
      outputSchema: getOperationOutputSchema,
      annotations: TRUSTED_CONFIG_READ_ONLY_ANNOTATIONS,
    },
    (input, extra) => getOperationTool(context, input, extra),
  )
  const generationAnnotations = context.generationMode === 'developer'
    ? { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } as const
    : { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const
  server.registerTool(
    'openapi_generate',
    {
      title: 'Generate OpenAPI Artifacts',
      description: context.generationMode === 'developer'
        ? 'Use for one trusted target when generated artifacts should be updated or previewed. In developer mode omitted mode means a persistent Workspace-confined write; pass mode dry-run for preview. Full, add, replace, and ephemeral selection semantics are explicit; ephemeral is dry-run only. Core validates output roots, ownership, managed deletion, locks, transactions, and recovery. Results are bounded and never expose complete source or machine paths.'
        : context.generationMode === 'hardened'
          ? 'Use to preview one trusted target only. Hardened openapi_generate is always dry-run; persistent generation requires openapi_prepare_generation followed by explicit approval and openapi_apply_generation. Results are bounded and never expose complete source or machine paths.'
          : 'Use to preview one trusted target only. Read-only openapi_generate is always dry-run and cannot request or perform persistent writes. Results are bounded and never expose complete source or machine paths.',
      inputSchema: generateInputSchemaForMode(context.generationMode),
      outputSchema: openapiGenerateOutputSchema,
      annotations: generationAnnotations,
    },
    (input: z.infer<ReturnType<typeof generateInputSchemaForMode>>, extra: McpHandlerExtra) => openapiGenerateTool(context, input, extra),
  )
  server.registerTool(
    'openapi_check_generation',
    {
      title: 'Check OpenAPI Generation',
      description: 'Use for CI/freshness questions: whether current configured generated files are outdated. Unlike dry-run, this focuses on current versus expected hashes and never repairs, writes, or deletes anything. Uses only startup-trusted config.',
      inputSchema: checkGenerationInputSchema,
      outputSchema: checkGenerationOutputSchema,
      annotations: TRUSTED_CONFIG_READ_ONLY_ANNOTATIONS,
    },
    (input, extra) => checkGenerationTool(context, input, extra),
  )
}

export function registerControlledWriteTools(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'openapi_prepare_generation',
    {
      title: 'Prepare Controlled OpenAPI Generation',
      description: 'Use first when the user wants generated SDK files updated or wants a reviewable write plan. Without selection it preserves the existing full plan/token flow. Selection type add accepts up to 500 exact keys per request and unions them with trusted persisted project selection; type replace accepts up to the complete 5,000-key persisted-selection limit, sets the non-empty desired selection exactly, and may plan managed deletions. Keys are limited to 500 UTF-8 bytes and the desired manifest to 1 MiB. Both generate the complete desired projection and return a bounded applyable plan plus one-time token. Prepare never writes selection, generated files, locks, staging, or ownership manifests. Exactly one trusted target/output root is supported; callers cannot choose paths, config, plugins, cleanup, or content.',
      inputSchema: prepareGenerationInputSchema,
      outputSchema: prepareGenerationOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    (input, extra) => prepareGenerationTool(context, input, extra),
  )
  server.registerTool(
    'openapi_apply_generation',
    {
      title: 'Apply Confirmed OpenAPI Generation Plan',
      description: 'Use only after the user explicitly confirms one unexpired openapi_prepare_generation result with applySupported true and its exact plan hash/token. Full plans keep the existing transaction path. Selective plans revalidate trusted source, config, selection, projection, complete artifacts, output, and ownership before atomically committing generated artifacts, ownership, and frozen selection state. Callers cannot pass targets, paths, content, force, or safety overrides.',
      inputSchema: applyGenerationInputSchema,
      outputSchema: applyGenerationOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    (input, extra) => applyGenerationTool(context, input, extra),
  )
}

export * from './validate.ts'
export * from './inspect.ts'
export * from './diff.ts'
export * from './generate.ts'
export * from './check-generation.ts'
export * from './prepare-generation.ts'
export * from './apply-generation.ts'
export * from './list-targets.ts'
export * from './search-operations.ts'
export * from './get-operation.ts'
