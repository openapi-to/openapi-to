import path from "node:path";
import type { OpenapiToSingleConfig } from "@openapi-to/core";
import { createPlugin, pluginEnum } from "@openapi-to/core";
import {
	formatterModuleSpecifier,
	getRelativePath,
} from "@openapi-to/core/utils";
import { kebabCase } from "lodash-es";
import {
	type FunctionDeclarationStructure,
	type ImportDeclarationStructure,
	Project,
	StructureKind,
} from "ts-morph";
import { buildImports } from "./builds/buildImports.ts";
import { buildMethodBody } from "./builds/buildMethodBody.ts";
import { buildMethodParameters } from "./builds/buildMethodParameters.ts";
import { jsDocTemplateFromMethod } from "./template/jsDocTemplateFromMethod.ts";
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
		dependencies: [
			...(_pluginConfig?.parser === "zod" ? [pluginEnum.Zod] : []),
			pluginEnum.TsType,
		],
		name: pluginEnum.Request,
		hooks: {
			buildStart: async (ctx) => {
				// 可注入日志、校验 pluginConfig
				// ctx.logger.info('Request 插件启动', pluginConfig)
				stateMap.set(ctx.openapiToSingleConfig, {
					project: new Project(),
					pluginConfig: {
						requestImportDeclaration: {
							moduleSpecifier:
								_pluginConfig?.requestImportDeclaration?.moduleSpecifier ||
								"@/utils/request",
						},
						requestConfigTypeImportDeclaration: {
							namedImports:
								_pluginConfig?.requestConfigTypeImportDeclaration
									?.namedImports || [],
							moduleSpecifier:
								_pluginConfig?.requestConfigTypeImportDeclaration
									?.moduleSpecifier || "",
						},
						requestClient: _pluginConfig?.requestClient || "axios",
						parser: _pluginConfig?.parser,
						importWithExtension: _pluginConfig?.importWithExtension ?? true,
						dataReturnType: _pluginConfig?.dataReturnType || "",
					},
				});
			},
			tagStart: async () => {},
			operation: async (operation, ctx) => {
				const state = stateMap.get(ctx.openapiToSingleConfig);
				if (!state) throw new Error("Request plugin state is not initialized");
				const { project, pluginConfig } = state;
				const requestName = `${operation.accessor.operationName}Service`;
				const statement: FunctionDeclarationStructure = {
					kind: StructureKind.Function,
					isAsync: true,
					name: requestName,
					parameters: buildMethodParameters(operation, pluginConfig),
					returnType: undefined,
					isExported: true,
					docs: jsDocTemplateFromMethod(operation),
					statements: buildMethodBody(operation, pluginConfig),
				};

				const filePath = path.join(
					ctx.openapiToSingleConfig.output.dir,
					kebabCase(operation.tagName),
					`${kebabCase(operation.accessor.operationName)}.service.ts`,
				);

				operation.accessor.setOperationRequest({
					filePath,
					requestName,
				});

				const operationSourceFile = project.createSourceFile(filePath, "", {
					overwrite: true,
				});

				const operationType = operation.accessor.operationTSType;
				const operationZodSchema = operation.accessor.operationZodSchema;
				operationSourceFile.addStatements(
					buildImports(
						[
							{
								kind: StructureKind.ImportDeclaration,
								isTypeOnly: true,
								namedImports: [
									operationType?.requestInput,
									operation.accessor.hasQueryParametersArray ? operationType?.queryParams : undefined,
									operationType?.body,
									operationType?.responseSuccess,
								].filter(Boolean),
								moduleSpecifier: formatterModuleSpecifier(
									getRelativePath(filePath, operationType?.filePath || ""),
									pluginConfig?.importWithExtension,
								),
							},
							...((pluginConfig?.parser === "zod"
								? [
										{
											kind: StructureKind.ImportDeclaration,
											namedImports: [
												operationZodSchema?.body,
												operationZodSchema?.responseSuccess,
											].filter(Boolean),
											moduleSpecifier: formatterModuleSpecifier(
												getRelativePath(
													filePath,
													operationZodSchema?.filePath || "",
												),
												pluginConfig?.importWithExtension,
											),
										},
									]
								: []) as Array<ImportDeclarationStructure>),
						],
						pluginConfig,
					),
				);
				operationSourceFile.addFunction(statement);
				ctx.setSourceFiles(
					[pluginEnum.Request, operation.accessor.operationName],
					operationSourceFile,
				);
			},
			tagEnd: async () => {},
		},
	};
});
