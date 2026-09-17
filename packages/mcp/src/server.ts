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
  const generationPlans = resolved.allowWrite
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
      instructions: resolved.allowWrite
        ? 'OpenAPI compiler tools with an operator-enabled controlled write capability. Writes require a separate Prepare result, explicit user review, and the matching one-time plan token/hash before atomic Apply. Apply is limited to startup-configured managed output; no tool modifies OpenAPI or config files.'
        : 'Read-only OpenAPI compiler tools. No tool writes, deletes, repairs, or overwrites files. Local paths and transitive references are confined to the startup Workspace. Generation tools, when present, use only the trusted startup configuration. Results are bounded and may report truncation.',
    },
  )
  const context = {
    options: resolved,
    logger,
    trustedConfig,
    ...(targetCatalogs ? { targetCatalogs } : {}),
    generationLock: new GenerationLock(),
    ...(generationPlans ? { generationPlans } : {}),
  }
  registerReadOnlyTools(server, context)
  if (resolved.allowWrite && generationPlans) {
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
