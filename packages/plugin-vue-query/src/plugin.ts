import path from "node:path";
import type { OpenapiToSingleConfig } from "@openapi-to/core";
import { createPlugin, isQueryOperation, operationSourcePath, pluginEnum } from "@openapi-to/core";
import { camelCase, kebabCase, upperFirst } from "lodash-es";
import { Project, StructureKind } from "ts-morph";
import { buildQueryGenericType } from "./builders/buildGenericType.ts";
import { buildImports } from "./builders/buildImports.ts";
import { buildMethodBody } from "./builders/buildMethodBody.ts";
import { buildMethodParameters } from "./builders/buildMethodParameters.ts";
import { buildQueryKey, buildQueryKeyType } from "./builders/buildQueryKey.ts";
import { buildTVariables } from "./builders/buildTVariables.ts";
import { buildTypeParameters } from "./builders/buildTypeParameters.ts";
import { jsDocTemplateFromMethod } from "./templates/jsDocTemplateFromMethod.ts";
import type { PluginConfig, RequiredPluginConfig } from "./types.ts";

const stateMap = new WeakMap<
	OpenapiToSingleConfig,
	{
		project: Project;
		pluginConfig: RequiredPluginConfig;
	}
>();

export const definePlugin = createPlugin<PluginConfig>((_pluginConfig) => {
	return {
		name: pluginEnum.VueQuery,
		dependencies: [pluginEnum.TsType, pluginEnum.Request],
		hooks: {
			buildStart: async (ctx) => {
				// 可注入日志、校验 pluginConfig
				// ctx.logger.info('Request 插件启动', pluginConfig)
				stateMap.set(ctx.openapiToSingleConfig, {
					project: new Project(),
					pluginConfig: {
						infinite: {
							pageNumParam: "",
						},
						requestConfigTypeImportDeclaration: {
							namedImports: _pluginConfig?.responseErrorTypeImportDeclaration
								?.namedImports ?? ["AxiosRequestConfig"],
							moduleSpecifier:
								_pluginConfig?.responseErrorTypeImportDeclaration
									?.moduleSpecifier ?? "axios",
						},
						responseErrorTypeImportDeclaration: {
							namedImports: _pluginConfig?.responseErrorTypeImportDeclaration
								?.namedImports ?? ["AxiosError"],
							moduleSpecifier:
								_pluginConfig?.responseErrorTypeImportDeclaration
									?.moduleSpecifier ?? "axios",
						},
						importWithExtension: _pluginConfig?.importWithExtension ?? true,
						placeholderData: {
							value:
								_pluginConfig?.placeholderData?.value ?? "keepPreviousData",
							pathInclude: _pluginConfig?.placeholderData?.pathInclude ?? [],
						},
						dataReturnType: _pluginConfig?.dataReturnType || "",
					},
				});
			},
			operation: async (operation, ctx) => {
				if (!operation.accessor.operationRequest?.requestName) return;
				if (operation.accessor.hasQuerystringParameter && operation.accessor.pathParameters.some((parameter) => camelCase(parameter.name) === 'querystring')) {
					ctx.addDiagnostic({ code: 'VUE_QUERY_BINDING_COLLISION', severity: 'error', message: 'Path parameter querystring conflicts with a generated runtime binding.', location: { path: operationSourcePath(operation) }, plugin: pluginEnum.VueQuery });
					return;
				}
				const state = stateMap.get(ctx.openapiToSingleConfig);
				if (!state) {
					new Error("VueQuery plugin state not found");
					return;
				}
				const { project, pluginConfig } = state;
				if (operation.sourceKind === "additional") {
					ctx.addDiagnostic({
						code: "VUE_QUERY_UNSUPPORTED_METHOD",
						severity: "error",
						message: `Vue Query generation does not support HTTP method ${operation.wireMethod}.`,
						location: { path: operationSourcePath(operation) },
						plugin: pluginEnum.VueQuery,
					});
					return;
				}
				if (operation.sourceMethod === "query") {
					const generatedBindings = new Set([
						...(operation.accessor.hasRequestBody ? ["data"] : []),
						...(operation.accessor.hasQuerystringParameter ? ["querystring"] : []),
						...(operation.accessor.hasQueryParameters ? ["params"] : []),
						"options",
						"userQueryOptions",
						"requestConfig",
						"headers",
						"cookies",
						"queryKey",
						"signal",
						"toValue",
						"useQuery",
						"queryOptions",
						`${operation.accessor.operationName}QueryKey`,
						operation.accessor.operationRequest?.requestName,
						...(pluginConfig.placeholderData
							? [pluginConfig.placeholderData.value]
							: []),
					].filter((name): name is string => Boolean(name)));
					const collision = operation.accessor.pathParameters
						.map((parameter) => camelCase(parameter.name))
						.find((name) => generatedBindings.has(name));
					if (collision) {
						ctx.addDiagnostic({
							code: "VUE_QUERY_BINDING_COLLISION",
							severity: "error",
							message: `Vue Query QUERY path parameter ${collision} conflicts with a generated runtime binding.`,
							location: { path: operationSourcePath(operation) },
							plugin: pluginEnum.VueQuery,
						});
						return;
					}
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

				if (isQueryOperation(operation)) {
					operationSourceFile.addStatements(
						buildQueryGenericType(operation, pluginConfig),
					);
				} else {
					operationSourceFile.addStatements(buildTVariables(operation));
				}

				//key
				operationSourceFile.addStatements([
					buildQueryKey(operation, pluginConfig),
					buildQueryKeyType(operation),
				]);

				operationSourceFile.addFunction({
					kind: StructureKind.Function,
					isAsync: false,
					name: hookName,
					typeParameters: buildTypeParameters(operation),
					parameters: buildMethodParameters(operation, pluginConfig),
					returnType: undefined,
					isExported: true,
					docs: jsDocTemplateFromMethod(operation),
					statements: buildMethodBody(operation, pluginConfig),
				});

				ctx.setSourceFiles(
					[pluginEnum.VueQuery, operation.accessor.operationName],
					operationSourceFile,
				);
			},
			buildEnd() {},
		},
	};
});
