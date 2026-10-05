import path from "node:path";
import type { OpenapiToSingleConfig } from "@openapi-to/core";
import { createPlugin, isQueryOperation, operationSourcePath, pluginEnum } from "@openapi-to/core";
import { camelCase, kebabCase, upperFirst } from "lodash-es";
import { Project, StructureKind } from "ts-morph";
import { buildImports } from "./builders/buildImports.ts";
import { buildMethodBody } from "./builders/buildMethodBody.ts";
import { buildMethodParameters } from "./builders/buildMethodParameters.ts";
import { buildQueryKey, buildQueryKeyType } from "./builders/buildQueryKey.ts";
import { jsDocTemplateFromMethod } from "./templates/jsDocTemplateFromMethod.ts";
import type { PluginConfig } from "./types.ts";

const stateMap = new WeakMap<
	OpenapiToSingleConfig,
	{
		project: Project;
		pluginConfig: PluginConfig;
	}
>();
export const definePlugin = createPlugin<PluginConfig>((_pluginConfig) => {
	return {
		name: pluginEnum.SWR,
		dependencies: [pluginEnum.TsType, pluginEnum.Request],
		hooks: {
			buildStart: async (ctx) => {
				// 可注入日志、校验 pluginConfig
				// ctx.logger.info('Request 插件启动', pluginConfig)
				stateMap.set(ctx.openapiToSingleConfig, {
					project: new Project(),
					pluginConfig: {
						..._pluginConfig,
						responseConfigTypeImportDeclaration: {
							namedImports:
								_pluginConfig?.responseConfigTypeImportDeclaration
									?.namedImports ?? [],
							moduleSpecifier:
								_pluginConfig?.responseConfigTypeImportDeclaration
									?.moduleSpecifier ?? "",
						},
						responseErrorTypeImportDeclaration: {
							namedImports:
								_pluginConfig?.responseErrorTypeImportDeclaration
									?.namedImports ?? [],
							moduleSpecifier:
								_pluginConfig?.responseErrorTypeImportDeclaration
									?.moduleSpecifier ?? "",
						},
						importWithExtension: _pluginConfig?.importWithExtension ?? true,
					},
				});
			},
			operation: async (operation, ctx) => {
				if (!operation.accessor.operationRequest?.requestName) return;
				if (operation.accessor.hasQuerystringParameter && operation.accessor.pathParameters.some((parameter) => camelCase(parameter.name) === 'querystring')) {
					ctx.addDiagnostic({ code: 'SWR_QUERY_BINDING_COLLISION', severity: 'error', message: 'Path parameter querystring conflicts with a generated runtime binding.', location: { path: operationSourcePath(operation) }, plugin: pluginEnum.SWR });
					return;
				}
				if (operation.sourceKind === "additional") {
					ctx.addDiagnostic({
						code: "SWR_UNSUPPORTED_METHOD",
						severity: "error",
						message: `SWR generation does not support HTTP method ${operation.wireMethod}.`,
						location: { path: operationSourcePath(operation) },
						plugin: pluginEnum.SWR,
					});
					return;
				}
				if (operation.sourceMethod === "query") {
					const generatedBindings = new Set([
						...(operation.accessor.hasRequestBody ? ["data"] : []),
						...(operation.accessor.hasQueryParameters ? ["params"] : []),
						...(operation.accessor.hasQuerystringParameter ? ["querystring"] : []),
						"options",
						"queryOptions",
						"shouldFetch",
						"headers",
						"cookies",
						"queryKey",
						"useSWR",
						`${operation.accessor.operationName}QueryKey`,
						operation.accessor.operationRequest?.requestName,
					].filter((name): name is string => Boolean(name)));
					const collision = operation.accessor.pathParameters
						.map((parameter) => camelCase(parameter.name))
						.find((name) => generatedBindings.has(name));
					if (collision) {
						ctx.addDiagnostic({
							code: "SWR_QUERY_BINDING_COLLISION",
							severity: "error",
							message: `SWR QUERY path parameter ${collision} conflicts with a generated runtime binding.`,
							location: { path: operationSourcePath(operation) },
							plugin: pluginEnum.SWR,
						});
						return;
					}
				}
				const state = stateMap.get(ctx.openapiToSingleConfig);

				if (!state) {
					new Error("SWR plugin state not found");
					return;
				}
				const { project, pluginConfig } = state;
				if (
					operation.sourceMethod === "query" &&
					operation.accessor.queryParameters.some(
						(parameter) => parameter.name === pluginConfig.infinite?.pageNumParam,
					)
				) {
					ctx.addDiagnostic({
						code: "SWR_QUERY_INFINITE_UNSUPPORTED",
						severity: "error",
						message: "SWR infinite-query generation cannot preserve an OpenAPI QUERY request body in its page key.",
						location: { path: operationSourcePath(operation) },
						plugin: pluginEnum.SWR,
					});
					return;
				}

				const baseName = `use${upperFirst(operation.accessor.operationName)}`;
				const suffix =
					isQueryOperation(operation) ? "query" : "mutation";

				const hookName = `${baseName}${upperFirst(suffix)}`;
				const filePath = path.join(
					ctx.openapiToSingleConfig.output.dir,
					kebabCase(operation.tagName),
					`${kebabCase(baseName)}.${suffix}.ts`,
				);
				const operationSourceFile = project.createSourceFile(filePath, "", {
					overwrite: true,
				});

				operationSourceFile.addStatements(
					buildImports(filePath, operation, pluginConfig),
				);

				//key
				operationSourceFile.addStatements([
					buildQueryKey(operation, pluginConfig),
					buildQueryKeyType(operation),
				]);

				operationSourceFile.addFunction({
					kind: StructureKind.Function,
					isAsync: false,
					name: hookName,
					parameters: buildMethodParameters(operation, pluginConfig),
					returnType: undefined,
					isExported: true,
					docs: jsDocTemplateFromMethod(operation),
					statements: buildMethodBody(operation, pluginConfig),
				});

				ctx.setSourceFiles(
					[pluginEnum.SWR, operation.accessor.operationName],
					operationSourceFile,
				);
			},
			buildEnd() {},
		},
	};
});
