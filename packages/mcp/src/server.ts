import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { version } from '../package.json'
import { GenerationLock } from './generation/generation-lock.ts'
import { TrustedTargetCatalogRegistry } from './catalog/trusted-target-registry.ts'
import { GenerationPlanStore } from './generation/plan-store.ts'
import { validateConfiguredOutputRoots } from './generation/service.ts'
import { TrustedConfigProvider } from './generation/trusted-config.ts'
import type { InternalGenerationWritePlan } from './generation/write-plan.ts'
import { createStderrLogger } from './logger.ts'
import { resolveMcpServerOptions, type OpenapiToMcpServerOptions } from './options.ts'
import { StartupConfigPreflightError } from './startup-diagnostics.ts'
import { registerControlledWriteTools, registerReadOnlyTools } from './tools/index.ts'

export function createOpenapiToMcpServer(options: OpenapiToMcpServerOptions): McpServer {
  const resolved = resolveMcpServerOptions(options)
  const logger = createStderrLogger({ format: resolved.logFormat, level: resolved.logLevel })
  const trustedConfig = new TrustedConfigProvider(resolved.workspaceRoot, resolved.configPath)
  const targetCatalogs = resolved.configPath ? new TrustedTargetCatalogRegistry(trustedConfig, resolved) : undefined
  const generationPlans = resolved.generationMode === 'hardened' && resolved.configPath
    ? new GenerationPlanStore<InternalGenerationWritePlan>({
        ttlMs: resolved.write.planTtlMs,
        maxPlans: resolved.write.maxPlans,
        maxPlanBytes: resolved.write.maxPlanBytes,
        maxTotalPlanBytes: resolved.write.maxTotalPlanBytes,
        onEvent: (event, plan) => logger.info(event === 'expired' ? 'generation_plan_expired' : 'generation_plan_rejected', { planId: plan.planId, planHashPrefix: plan.planHash.slice(0, 12), reason: event }),
      })
    : undefined
  const server = new McpServer(
    { name: '@openapi-to/mcp', version },
    {
      instructions: resolved.generationMode === 'developer'
        ? 'OpenAPI compiler tools in developer generation mode. With trusted config, openapi_generate defaults to a Workspace-confined, Core-validated persistent generation; pass mode dry-run for preview. Tool arguments cannot modify OpenAPI/config sources, plugins, network policy, ownership, or transaction safety. Results are bounded and may report truncation.'
        : resolved.generationMode === 'hardened'
          ? 'OpenAPI compiler tools in hardened generation mode. openapi_generate is preview-only; persistent generation requires openapi_prepare_generation, explicit review, and the matching one-time plan token/hash before atomic Apply. Writes are limited to Core-validated Workspace output; no tool modifies OpenAPI or config files. Results are bounded and may report truncation.'
          : 'OpenAPI compiler tools in read-only generation mode. Generation is preview/check only and performs no persistent writes. Local paths and transitive references are confined to the startup Workspace. Generation tools use only the trusted startup configuration. Results are bounded and may report truncation.',
    },
  )
  const context = {
    options: resolved,
    generationMode: resolved.generationMode,
    logger,
    trustedConfig,
    ...(targetCatalogs ? { targetCatalogs } : {}),
    generationLock: new GenerationLock(),
    ...(generationPlans ? { generationPlans } : {}),
  }
  registerReadOnlyTools(server, context)
  if (resolved.generationMode === 'hardened' && generationPlans) {
    const initializeWrite = validateConfiguredOutputRoots(trustedConfig, resolved).then(() => registerControlledWriteTools(server, context))
    const connect = server.connect.bind(server)
    server.connect = async (transport) => {
      try {
        await initializeWrite
      } catch (error) {
        throw new StartupConfigPreflightError(error)
      }
      return connect(transport)
    }
  }
  const close = server.close.bind(server)
  server.close = async () => {
    generationPlans?.clear()
    targetCatalogs?.clear()
    await close()
  }
  return server
}
