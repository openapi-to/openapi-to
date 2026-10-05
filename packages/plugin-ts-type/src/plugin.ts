import path from "node:path";
import { createPlugin, inspectOpenAPI32MediaContent, inspectOpenAPI32OperationMedia, pluginEnum } from "@openapi-to/core";
import { forEach, kebabCase, upperFirst } from "lodash-es";
import { Project } from "ts-morph";
import { buildEnum } from "@/builds/buildEnum.ts";
import { buildTypeImports } from "@/builds/buildTypeImports.ts";
import { buildComponentParameters } from "@/builds/components/buildComponentParameters.ts";
import { buildComponentsRequestBody } from "@/builds/components/buildComponentsRequestBody.ts";
import { buildComponentsResponse } from "@/builds/components/buildComponentsResponse.ts";
import type { SchemaDeclarationStructure } from "@/builds/components/buildSchemas.ts";
import { buildSchemas } from "@/builds/components/buildSchemas.ts";

import { collectEnumFormOperation } from "@/collect/collectEnumFormOperation.ts";
import {
	collectEnumsFromComponentParameters,
	collectEnumsFromComponentRequestBody,
	collectEnumsFromComponentResponse,
	collectEnumsFromComponentSchema,
} from "@/collect/collectEnumsFromDocument.ts";
import {
	collectRefsFromComponentParameters,
	collectRefsFromComponentRequestBody,
	collectRefsFromComponentResponse,
} from "@/collect/collectRefsFromDocument.ts";
import { collectRefsFromOperation } from "@/collect/collectRefsFromOperation.ts";
import { collectRefsFromSchema } from "@/collect/collectRefsFromSchemas.ts";
import { EnumRegistry } from "@/EnumRegistry.ts";
import { getOperationTSTypeName } from "@/templates/operationTypeNameTemplate.ts";
import { getDataReturnType } from "@/utils/getDataReturnType.ts";
import { buildRefImports } from "@/utils/buildRefImports.ts";
import { InlineEnumSymbolAllocator } from "@/utils/inlineEnumNaming.ts";
import { buildOperationTypes } from "./builds/buildOperationTypes.ts";
import type { PluginConfig } from "./types.ts";

function addMediaDiagnostics(ctx: { addDiagnostic: (diagnostic: { code: string; severity: "error"; message: string; location: { path: Array<string | number> }; plugin: typeof pluginEnum.TsType }) => void }, entries: ReturnType<typeof inspectOpenAPI32MediaContent>): void {
	for (const entry of entries) {
		if (entry.semantics && !entry.semantics.hasItemSchema) continue;
		ctx.addDiagnostic({ code: "TS_TYPE_ITEM_STREAM_UNSUPPORTED", severity: "error", message: "OpenAPI 3.2 item-level media semantics cannot be represented by a complete-content TypeScript type.", location: { path: entry.path }, plugin: pluginEnum.TsType });
	}
}

interface PluginState {
	project: Project;
	componentFolderPath: string;
	operationFileNameOfTag: Set<string>;
	enumRegistry: EnumRegistry;
	inlineEnumSymbols: InlineEnumSymbolAllocator<
		ReturnType<typeof collectEnumFormOperation>[number]
	>;
}

const pluginStateKey = Symbol("@openapi-to/plugin-ts-type/state");

function getState(store: Map<unknown, unknown>): PluginState {
	const state = store.get(pluginStateKey);
	if (!state) throw new Error("Type plugin state was not initialized.");
	return state as PluginState;
}

export const definePlugin = createPlugin((pluginConfig?: PluginConfig) => {
	return {
		name: pluginEnum.TsType,
		hooks: {
			buildStart: async (ctx) => {
				const components = ctx.openapiHelper.oas.getDefinition().components;
				const formatterName = (name: string) =>
					ctx.openapiHelper.formatterName(name);
				const inlineEnumSources = [
					...ctx.openapiHelper
						.getAllOperations()
						.flatMap((operation) =>
							collectEnumFormOperation({ ...operation, tagName: "" }),
						),
					...Object.entries(components?.schemas ?? {}).flatMap(
						([schemaName, schema]) =>
							collectEnumsFromComponentSchema(
								schema,
								formatterName(schemaName),
								schemaName,
							),
					),
					...collectEnumsFromComponentParameters(
						components?.parameters ?? {},
						formatterName,
					),
					...Object.entries(components?.requestBodies ?? {}).flatMap(
						([requestBodyName, requestBody]) =>
							collectEnumsFromComponentRequestBody(
								requestBody,
								`RequestBodies${upperFirst(formatterName(requestBodyName))}Model`,
								requestBodyName,
								ctx.openAPIDialect === "3.2" ? ctx.openAPIDocument : undefined,
							),
					),
					...Object.entries(components?.responses ?? {}).flatMap(
						([responseName, response]) =>
							collectEnumsFromComponentResponse(
								response,
								`Response${upperFirst(formatterName(responseName))}`,
								responseName,
								ctx.openAPIDialect === "3.2" ? ctx.openAPIDocument : undefined,
							),
					),
				];
				ctx.store.set(pluginStateKey, {
					project: new Project(),
					componentFolderPath: path.join(
						ctx.openapiToSingleConfig.output.dir,
						"types",
					),
					operationFileNameOfTag: new Set(),
					enumRegistry: new EnumRegistry(),
					inlineEnumSymbols: new InlineEnumSymbolAllocator(inlineEnumSources),
				});
			},
			tagStart: async (_tagData, ctx) => {
				const state = getState(ctx.store);
				//tag开始时，清空当前tag的operation记录
				state?.operationFileNameOfTag.clear();
			},
			operation: async (operation, ctx) => {
				if (ctx.openAPIDialect === "3.2") addMediaDiagnostics(ctx, inspectOpenAPI32OperationMedia(operation.accessor.operation, operation.sourcePath));
				const {
					project,
					componentFolderPath,
					operationFileNameOfTag,
					enumRegistry,
					inlineEnumSymbols,
				} = getState(ctx.store);
				const fileName = `${kebabCase(operation.accessor.operationName)}.types.ts`;
				const filePath = path.join(
					ctx.openapiToSingleConfig.output.dir,
					kebabCase(operation.tagName),
					fileName,
				);
				//`${ctx.openapiToSingleConfig.output.dir}${pluginConfig?.output.dir}/${lowerFirst(operation.formattedTagName)}/${fileName}.ts`
				operationFileNameOfTag.add(fileName);

				const operationEnums = collectEnumFormOperation(operation);
				const allocatedOperationEnums = operationEnums.map((item) =>
					inlineEnumSymbols.getEnumItem(item),
				);

				enumRegistry.adds(allocatedOperationEnums);

				const operationStatements = buildOperationTypes(
					operation,
					inlineEnumSymbols,
				);

				//保存类型名
				operation.accessor.setOperationTSType({
					...getOperationTSTypeName(operation),
					filePath,
				});

				operation.accessor.setDataReturnType(getDataReturnType(operation));

				const operationSourceFile = project.createSourceFile(filePath, "", {
					overwrite: true,
				});

				const imports = buildRefImports(
					collectRefsFromOperation(operation),
					filePath,
					componentFolderPath,
					pluginConfig?.importWithExtension,
				);
				operationSourceFile.addStatements(imports);

				const enumNames = allocatedOperationEnums.map((item) =>
					enumRegistry.getEnumValueName(item.enumValue, item.name),
				);
				operationSourceFile.addStatements(
					buildTypeImports(enumNames, "../types/enum.model.ts"),
				);

				operationSourceFile.addStatements(operationStatements);
				ctx.setSourceFiles(
					[
						pluginEnum.TsType,
						operation.tagName,
						operation.accessor.operationName,
					],
					operationSourceFile,
				);
			},
			tagEnd: async () => {},
			componentsSchemas: async (schemas, ctx) => {
				const {
					project,
					componentFolderPath,
					enumRegistry,
					inlineEnumSymbols,
				} = getState(ctx.store);
				const schemaEntries = Object.entries(schemas).map(
					([schemaName, schema]) => {
						const formatterSchemaName =
							ctx.openapiHelper.formatterName(schemaName);
						return {
							schemaName,
							schema,
							formatterSchemaName,
							enums: collectEnumsFromComponentSchema(
								schema,
								formatterSchemaName,
								schemaName,
							),
						};
					},
				);
				for (const {
					schemaName,
					schema,
					formatterSchemaName,
					enums,
				} of schemaEntries) {

					const fileName = `${kebabCase(formatterSchemaName)}.model.ts`;

					const filePath = path.join(
						ctx.openapiToSingleConfig.output.dir,
						"types",
						"models",
						fileName,
					);

					const allocatedEnums = enums.map((item) =>
						inlineEnumSymbols.getEnumItem(item),
					);

					enumRegistry.adds(allocatedEnums);

					const enumNames = allocatedEnums.map((item) =>
						enumRegistry.getEnumValueName(item.enumValue, item.name),
					);

					const schemaSourceFile = project.createSourceFile(filePath, "", {
						overwrite: true,
					});
					const statements: SchemaDeclarationStructure[] = buildSchemas(
						formatterSchemaName,
						schema,
						inlineEnumSymbols,
						["components", "schemas", schemaName],
					);
					const refs = collectRefsFromSchema(schema);

					const imports = buildRefImports(
						refs,
						filePath,
						componentFolderPath,
						pluginConfig?.importWithExtension,
					);

					schemaSourceFile.addStatements(imports);

					schemaSourceFile.addStatements(
						buildTypeImports(enumNames, "../enum.model.ts"),
					);
					schemaSourceFile.addStatements(statements);

					ctx.setSourceFiles(
						[pluginEnum.TsType, "componentsSchemas", schemaName],
						schemaSourceFile,
					);
				}
			},
			componentsParameters(parameters, ctx) {
				const {
					project,
					componentFolderPath,
					enumRegistry,
					inlineEnumSymbols,
				} = getState(ctx.store);

				forEach(parameters, (parameter, parameterName) => {
					const formatterParameterName =
						ctx.openapiHelper.formatterName(parameterName);

					const fileName = `${kebabCase(formatterParameterName)}.model.ts`;

					const filePath = path.join(
						componentFolderPath,
						"parameters",
						fileName,
					);
					const parameterSourceFile = project.createSourceFile(filePath, "", {
						overwrite: true,
					});
					const enums = collectEnumsFromComponentParameters({
						[parameterName]: parameter,
					}, ctx.openapiHelper.formatterName.bind(ctx.openapiHelper));
					const allocatedEnums = enums.map((item) =>
						inlineEnumSymbols.getEnumItem(item),
					);
					const statements: SchemaDeclarationStructure | undefined =
						buildComponentParameters(
							parameter,
							formatterParameterName,
							inlineEnumSymbols,
							["components", "parameters", parameterName, "schema"],
						);
					if (statements) {
						enumRegistry.adds(allocatedEnums);
						const imports = buildRefImports(
							collectRefsFromComponentParameters({
								[parameterName]: parameter,
							}),
							filePath,
							componentFolderPath,
							pluginConfig?.importWithExtension,
						);

						parameterSourceFile.addStatements(imports);
						parameterSourceFile.addStatements(
							buildTypeImports(
								allocatedEnums.map((item) =>
									enumRegistry.getEnumValueName(item.enumValue, item.name),
								),
								"../enum.model.ts",
							),
						);

						parameterSourceFile.addStatements([statements]);

						ctx.setSourceFiles(
							[pluginEnum.TsType, "componentsParameters", parameterName],
							parameterSourceFile,
						);
					}
				});
			},
			componentsRequestBodies(requestBodies, ctx) {
				const {
					project,
					componentFolderPath,
					enumRegistry,
					inlineEnumSymbols,
				} = getState(ctx.store);
				// components.requestBodies
				for (const [requestBodyName, requestObject] of Object.entries(
					requestBodies,
				)) {
					const formatterName =
						ctx.openapiHelper.formatterName(requestBodyName);
					const enums = collectEnumsFromComponentRequestBody(
						requestObject,
						`RequestBodies${upperFirst(formatterName)}Model`,
						requestBodyName,
						ctx.openAPIDialect === "3.2" ? ctx.openAPIDocument : undefined,
					);
					const allocatedEnums = enums.map((item) =>
						inlineEnumSymbols.getEnumItem(item),
					);
					enumRegistry.adds(allocatedEnums);

					const componentPath = ["components", "requestBodies", requestBodyName];
					if (ctx.openAPIDialect === "3.2") addMediaDiagnostics(ctx, inspectOpenAPI32MediaContent(ctx.openAPIDocument, requestObject, componentPath));
					const refs = collectRefsFromComponentRequestBody(requestObject, ctx.openAPIDialect === "3.2" ? ctx.openAPIDocument : undefined);

					const fileName = `${kebabCase(formatterName)}.model.ts`;

					//
					const filePath = path.join(
						componentFolderPath,
						"requestBodies",
						fileName,
					);
					const requestBodySourceFile = project.createSourceFile(filePath, "", {
						overwrite: true,
					});
					const statements: SchemaDeclarationStructure | undefined =
						buildComponentsRequestBody(
							formatterName,
							requestObject,
							inlineEnumSymbols,
							["components", "requestBodies", requestBodyName],
						...(ctx.openAPIDialect === "3.2" ? [ctx.openAPIDocument] : []),
						);
					if (statements) {
						const imports = buildRefImports(
							refs,
							filePath,
							componentFolderPath,
							pluginConfig?.importWithExtension,
						);

						requestBodySourceFile.addStatements(imports);
						requestBodySourceFile.addStatements(
							buildTypeImports(
								allocatedEnums.map((item) =>
									enumRegistry.getEnumValueName(item.enumValue, item.name),
								),
								"../enum.model.ts",
							),
						);

						requestBodySourceFile.addStatements([statements]);
						ctx.setSourceFiles(
							[pluginEnum.TsType, "componentsRequestBodies", requestBodyName],
							requestBodySourceFile,
						);
					}
				}
			},
			componentsResponses(responses, ctx) {
				const {
					project,
					componentFolderPath,
					enumRegistry,
					inlineEnumSymbols,
				} = getState(ctx.store);
				// components.responses
				forEach(responses, (response, responseName) => {
					const formatterResponse =
						ctx.openapiHelper.formatterName(responseName);

					const responseTypeName = `Response${upperFirst(formatterResponse)}`;
					const enums = collectEnumsFromComponentResponse(
						response,
						responseTypeName,
						responseName,
						ctx.openAPIDialect === "3.2" ? ctx.openAPIDocument : undefined,
					);
					const allocatedEnums = enums.map((item) =>
						inlineEnumSymbols.getEnumItem(item),
					);
					enumRegistry.adds(allocatedEnums);
					//todo responses
					const statements = buildComponentsResponse(
						response,
						responseTypeName,
						inlineEnumSymbols,
						["components", "responses", responseName],
						...(ctx.openAPIDialect === "3.2" ? [ctx.openAPIDocument] : []),
					);

					if (ctx.openAPIDialect === "3.2") addMediaDiagnostics(ctx, inspectOpenAPI32MediaContent(ctx.openAPIDocument, response, ["components", "responses", responseName]));
					const refs = collectRefsFromComponentResponse(response, ctx.openAPIDialect === "3.2" ? ctx.openAPIDocument : undefined);

					const fileName = `${kebabCase(formatterResponse)}.model.ts`;

					const filePath = path.join(
						componentFolderPath,
						"responses",
						fileName,
					);

					const responseSourceFile = project.createSourceFile(filePath, "", {
						overwrite: true,
					});

					if (statements) {
						const imports = buildRefImports(
							refs,
							filePath,
							componentFolderPath,
							pluginConfig?.importWithExtension,
						);

						responseSourceFile.addStatements(imports);
						responseSourceFile.addStatements(
							buildTypeImports(
								allocatedEnums.map((item) =>
									enumRegistry.getEnumValueName(item.enumValue, item.name),
								),
								"../enum.model.ts",
							),
						);
						responseSourceFile.addStatements([statements]);
						ctx.setSourceFiles(
							[pluginEnum.TsType, "componentsResponses", responseName],
							responseSourceFile,
						);
					}
				});
			},
			buildEnd: async (ctx) => {
				const { project, componentFolderPath, enumRegistry } = getState(
					ctx.store,
				);
				const enumVariableStatements = buildEnum(enumRegistry.getAll());
				const filePath = path.join(componentFolderPath, "enum.model.ts");
				const enumSourceFile = project.createSourceFile(filePath, "", {
					overwrite: true,
				});
				enumSourceFile.addStatements(enumVariableStatements);
				ctx.setSourceFiles([pluginEnum.TsType, "enum.model"], enumSourceFile);
			},
		},
	};
});
