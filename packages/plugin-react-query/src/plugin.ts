import path from 'node:path'
import type { OperationWrapper } from '@openapi-to/core'
import { createPlugin, pluginEnum } from '@openapi-to/core'
import { kebabCase } from 'lodash-es'
import { Project } from 'ts-morph'
import { buildImports } from './builders/buildImports.ts'
import { buildMutation } from './builders/buildMutation.ts'
import { buildQuery } from './builders/buildQuery.ts'
import { operationFileName } from './builders/names.ts'
import type { PluginConfig, ResolvedPluginConfig } from './types.ts'

const supportedMethods = new Set(['get', 'post', 'put', 'patch', 'delete'])

function resolveConfig(config?: PluginConfig): ResolvedPluginConfig {
	return {
		hooks: config?.hooks ?? true,
		importWithExtension: config?.importWithExtension ?? true,
		requestConfigTypeImportDeclaration: config?.requestConfigTypeImportDeclaration ?? {
			namedImports: ['AxiosRequestConfig'],
			moduleSpecifier: 'axios',
		},
		responseErrorTypeImportDeclaration: config?.responseErrorTypeImportDeclaration ?? {
			namedImports: ['AxiosError'],
			moduleSpecifier: 'axios',
		},
	}
}

function diagnostic(operation: OperationWrapper, code: string, message: string) {
	return {
		code,
		severity: 'error' as const,
		message,
		location: { path: ['paths', operation.path, operation.method] },
		plugin: pluginEnum.ReactQuery,
	}
}

function metadataAvailable(operation: OperationWrapper): boolean {
	return Boolean(
		operation.accessor.operationTSType?.filePath &&
		operation.accessor.operationRequest?.filePath &&
		operation.accessor.operationRequest?.requestName,
	)
}

export const definePlugin = createPlugin<PluginConfig>((pluginConfig) => {
	const config = resolveConfig(pluginConfig)
	return {
		name: pluginEnum.ReactQuery,
		dependencies: [pluginEnum.TsType, pluginEnum.Request],
		hooks: {
			operation: (operation, ctx) => {
				if (!operation.accessor.operationId) {
					ctx.addDiagnostic(diagnostic(operation, 'REACT_QUERY_OPERATION_ID_MISSING', 'React Query generation requires every operation to have an operationId.'))
					return
				}
				if (!supportedMethods.has(operation.method)) {
					ctx.addDiagnostic(diagnostic(operation, 'REACT_QUERY_UNSUPPORTED_METHOD', `React Query generation does not support HTTP method ${operation.method.toUpperCase()}.`))
					return
				}
				if (!metadataAvailable(operation)) {
					ctx.addDiagnostic(diagnostic(operation, 'REACT_QUERY_METADATA_MISSING', 'React Query generation requires TsType and Request operation metadata.'))
					return
				}
				const kind = operation.method === 'get' ? 'query' : 'mutation'
				const filePath = path.join(ctx.openapiToSingleConfig.output.dir, kebabCase(operation.tagName), operationFileName(operation, kind))
				const project = new Project()
				const sourceFile = project.createSourceFile(filePath, '', { overwrite: true })
				const targetIdentity = ctx.openapiToSingleConfig.name ?? 'default'
				const source = kind === 'query' ? buildQuery(operation, config, targetIdentity) : buildMutation(operation, config, targetIdentity)
				sourceFile.addStatements(`${buildImports(filePath, operation, config, config.hooks)}\n\n${source}`)
				ctx.addArtifact({ kind: 'typescript', path: filePath, sourceFile, plugin: pluginEnum.ReactQuery })
			},
		},
	}
})
