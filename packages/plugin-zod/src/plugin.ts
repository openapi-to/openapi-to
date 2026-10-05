import path from "node:path";
import type { Diagnostic, OpenapiToSingleConfig } from "@openapi-to/core";
import {
	createPlugin,
	describeOperationResponses,
	describeResponseHeaders,
	getOperationRequestBodyMediaTypes,
	inspectOpenAPI32MediaContent,
	inspectOpenAPI32OperationMedia,
	operationSourcePath,
	pluginEnum,
} from "@openapi-to/core";
import {
	formatterModuleSpecifier,
	getRelativePath,
} from "@openapi-to/core/utils";
import { forEach, kebabCase } from "lodash-es";
import { Project } from "ts-morph";
import { buildSchemaImports } from "@/builds/buildSchemaImports.ts";
import { buildComponentParameters } from "@/builds/components/buildComponentParameters.ts";
import { buildComponentsRequestBody } from "@/builds/components/buildComponentsRequestBody.ts";
import { buildComponentsResponse } from "@/builds/components/buildComponentsResponse.ts";
import { buildSchemas } from "@/builds/components/buildSchemas.ts";
import {
	collectRefsFromComponentParameters,
	collectRefsFromComponentRequestBody,
	collectRefsFromComponentResponse,
} from "@/collect/collectRefsFromDocument.ts";
import { collectRefsFromOperation } from "@/collect/collectRefsFromOperation.ts";
import { collectRefsFromSchema } from "@/collect/collectRefsFromSchemas.ts";
import {
	findRecursiveSchemaRefs,
	findUnguardedRecursiveSchemaRefs,
} from "@/collect/findRecursiveSchemaRefs.ts";
import { importZodTemplate } from "@/templates/importZodTemplate.ts";
import { getOperationZodSchemaName } from "@/templates/operationTypeNameTemplate.ts";
import { responseHeadersTemplate } from "@/templates/responseHeadersTemplate.ts";
import type { SchemaRenderOptions } from "@/templates/schemaTemplate.ts";
import {
	getComponentExportName,
	getComponentFilePath,
	getComponentRefExportName,
	getComponentRefOutputTypeName,
} from "@/utils/componentNaming.ts";
import { buildOperationTypes } from "./builds/buildOperationTypes.ts";
import type { PluginConfig } from "./types.ts";

function addMediaDiagnostics(ctx: { addDiagnostic(diagnostic: Diagnostic): void }, entries: ReturnType<typeof inspectOpenAPI32MediaContent>): void {
	for (const entry of entries) {
		if (entry.semantics && !entry.semantics.hasItemSchema) continue;
		ctx.addDiagnostic({ code: "ZOD_ITEM_STREAM_UNSUPPORTED", severity: "error", message: "OpenAPI 3.2 item-level media validation is unavailable; generated z.never().", location: { path: entry.path }, plugin: pluginEnum.Zod });
	}
}

const schemaFolderName = "zod";
const diagnosticMediaTypeLimit = 5;

function addMultipleMediaDiagnostic(
	ctx: { addDiagnostic(diagnostic: Diagnostic): void },
	locationPath: Array<string | number>,
	mediaTypes: readonly string[],
): void {
	const sorted = [...mediaTypes].sort((left, right) =>
		left < right ? -1 : left > right ? 1 : 0,
	);
	const shown = sorted
		.slice(0, diagnosticMediaTypeLimit)
		.map((mediaType) =>
			mediaType.length > 120 ? `${mediaType.slice(0, 117)}...` : mediaType,
		);
	const omitted = sorted.length - shown.length;
	ctx.addDiagnostic({
		code: "ZOD_MULTIPLE_MEDIA_TYPES_UNSUPPORTED",
		severity: "error",
		message: [
			"Multiple media representations require Content-Type-aware validation.",
			"Generated z.never() instead of selecting one representation.",
			`Declared media types: ${shown.join(", ")}${omitted > 0 ? `, and ${omitted} more` : ""}.`,
		].join(" "),
		plugin: pluginEnum.Zod,
		location: { path: locationPath },
	});
}

function addInvalidContentDiagnostic(
	ctx: { addDiagnostic(diagnostic: Diagnostic): void },
	locationPath: Array<string | number>,
	kind: "Parameter" | "Header",
): void {
	ctx.addDiagnostic({
		code: "ZOD_INVALID_CONTENT_CARDINALITY",
		severity: "error",
		message: `${kind} Object content must contain exactly one media type entry; generated z.never() for the invalid content value.`,
		plugin: pluginEnum.Zod,
		location: { path: locationPath },
	});
}

const stateMap = new WeakMap<
	OpenapiToSingleConfig,
	{
		project: Project;
		componentOutputDir: string;
		unguardedRecursiveRefs: Set<string>;
	}
>();

function getState(config: OpenapiToSingleConfig) {
	const state = stateMap.get(config);
	if (!state) {
		throw new Error("Zod plugin build state was not initialized.");
	}
	return state;
}

function schemaRenderOptions(
	sink: {
		addDiagnostic(diagnostic: Diagnostic): void;
		openAPIDialect: "3.0" | "3.1" | "3.2" | "unknown";
	},
	locationPath: string[],
	unguardedRecursiveRefs?: ReadonlySet<string>,
): SchemaRenderOptions {
	return {
		refSemanticContext: {
			dialect: sink.openAPIDialect,
			objectContext: "schema",
		},
		unguardedRecursiveRefs,
		onDiagnostic(diagnostic) {
			sink.addDiagnostic({
				...diagnostic,
				severity:
					diagnostic.code === "ZOD_UNSUPPORTED_REQUIRED_WITHOUT_OBJECT_CONTEXT" ||
					diagnostic.code === "ZOD_UNSUPPORTED_VALIDATION_KEYWORD" ||
					diagnostic.code === "ZOD_MULTIPLE_MEDIA_TYPES_UNSUPPORTED" ||
					diagnostic.code === "ZOD_INVALID_CONTENT_CARDINALITY" ||
					diagnostic.code === "ZOD_RESPONSE_HEADER_NAME_COLLISION" ||
					diagnostic.code === "ZOD_RESPONSE_HEADER_REFERENCE_UNRESOLVED"
						? "error"
						: "warning",
				plugin: pluginEnum.Zod,
				location: { path: locationPath },
			});
		},
	};
}

function buildRefImports(
	refs: readonly string[],
	filePath: string,
	componentOutputDir: string,
	importWithExtension: boolean | undefined,
	recursiveRefs?: ReadonlySet<string>,
) {
	const importsByPath = new Map<
		string,
		{ values: Set<string>; types: Set<string> }
	>();
	for (const ref of refs) {
		const targetPath = getComponentFilePath(ref, componentOutputDir);
		if (path.resolve(targetPath) === path.resolve(filePath)) continue;
		const names = importsByPath.get(targetPath) ?? {
			values: new Set<string>(),
			types: new Set<string>(),
		};
		names.values.add(getComponentRefExportName(ref));
		if (recursiveRefs?.has(ref)) {
			names.types.add(getComponentRefOutputTypeName(ref));
		}
		importsByPath.set(targetPath, names);
	}
	return [...importsByPath.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.flatMap(([targetPath, names]) =>
			buildSchemaImports(
				[...names.values],
				formatterModuleSpecifier(
					getRelativePath(filePath, targetPath),
					importWithExtension,
				),
				[...names.types],
			),
		);
}

export const definePlugin = createPlugin((pluginConfig?: PluginConfig) => {
	return {
		name: pluginEnum.Zod,
		hooks: {
			buildStart: async (ctx) => {
				stateMap.set(ctx.openapiToSingleConfig, {
					project: new Project(),
					componentOutputDir: path.join(
						ctx.openapiToSingleConfig.output.dir,
						schemaFolderName,
					),
					unguardedRecursiveRefs: new Set(),
				});
			},
			operation: async (operation, ctx) => {
				if (ctx.openAPIDialect === "3.2") addMediaDiagnostics(ctx, inspectOpenAPI32OperationMedia(operation.accessor.operation, operationSourcePath(operation)));
				const { project, componentOutputDir, unguardedRecursiveRefs } =
					getState(ctx.openapiToSingleConfig);
				const fileName = `${kebabCase(operation.accessor.operationName)}.schema.ts`;
				const filePath = path.join(
					ctx.openapiToSingleConfig.output.dir,
					kebabCase(operation.tagName),
					fileName,
				);
				const operationLocation = operationSourcePath(operation);
				const requestMediaTypes = getOperationRequestBodyMediaTypes(
					operation.accessor.operation,
				);
				if (requestMediaTypes.length > 1) {
					addMultipleMediaDiagnostic(
						ctx,
						[...operationLocation, "requestBody", "content"],
						requestMediaTypes,
					);
				}
				const pathItemParameters =
					operation.accessor.operation.api?.paths?.[
						operation.accessor.operation.path
					]?.parameters;
				for (const [parameters, parameterPath] of [
					[
						operation.accessor.operation.schema?.parameters,
						[...operationLocation, "parameters"],
					],
					[
						pathItemParameters,
						["paths", operation.accessor.operation.path, "parameters"] as Array<
							string | number
						>,
					],
				] as const) {
					if (!Array.isArray(parameters)) continue;
					parameters.forEach((parameter, index) => {
						if (
							typeof parameter !== "object" ||
							parameter === null ||
							Array.isArray(parameter)
						)
							return;
						const candidate = parameter as {
							$ref?: string;
							content?: Record<string, unknown>;
						};
						if (
							!candidate.$ref &&
							Object.keys(candidate.content ?? {}).length > 1
						) {
							addInvalidContentDiagnostic(
								ctx,
								[...parameterPath, index, "content"],
								"Parameter",
							);
						}
					});
				}
				for (const descriptor of describeOperationResponses(
					operation.accessor.operation,
				)) {
					if ((descriptor.inspection?.length ?? 0) > 1) {
						addMultipleMediaDiagnostic(
							ctx,
							[
								...operationLocation,
								"responses",
								descriptor.sourceStatusCode,
								"content",
							],
							descriptor.inspection?.flatMap(({ contentType }) =>
								contentType ? [contentType] : [],
							) ?? [],
						);
					}
					for (const header of descriptor.headers?.headers ?? []) {
						if (header.invalidContent) {
							addInvalidContentDiagnostic(
								ctx,
								[
									...operationLocation,
									"responses",
									descriptor.sourceStatusCode,
									"headers",
									header.sourceName,
									"content",
								],
								"Header",
							);
						}
					}
				}
				const operationStatements = buildOperationTypes(
					operation,
					schemaRenderOptions(
						ctx,
							operationSourcePath(operation).map(String),
						unguardedRecursiveRefs,
					),
				);

				//
				operation.accessor.setOperationZodSchemaName({
					...getOperationZodSchemaName(operation),
					filePath,
				});

				const operationSourceFile = project.createSourceFile(filePath, "", {
					overwrite: true,
				});

				const imports = buildRefImports(
					collectRefsFromOperation(operation, {
						omitUnguardedRefsWithinOneOf: unguardedRecursiveRefs,
						refSemanticContext: {
							dialect: ctx.openAPIDialect,
							objectContext: "schema",
						},
					}),
					filePath,
					componentOutputDir,
					pluginConfig?.importWithExtension,
				);

				operationSourceFile.addStatements([
					...imports,
					importZodTemplate,
					...operationStatements,
				]);
				ctx.setSourceFiles(
					[pluginEnum.Zod, operation.tagName, operation.accessor.operationName],
					operationSourceFile,
				);
			},
			componentsSchemas: async (schemas, ctx) => {
				const { project, componentOutputDir } = getState(
					ctx.openapiToSingleConfig,
				);
				const refSemanticContext = {
					dialect: ctx.openAPIDialect,
					objectContext: "schema",
				} as const;
				const recursiveRefs = findRecursiveSchemaRefs(schemas, {
					refSemanticContext,
				});
				const unguardedRecursiveRefs = findUnguardedRecursiveSchemaRefs(
					schemas,
					{ refSemanticContext },
				);
				getState(ctx.openapiToSingleConfig).unguardedRecursiveRefs =
					unguardedRecursiveRefs;
				for (const [schemaName, schema] of Object.entries(schemas)) {
					const formatterSchemaName =
						ctx.openapiHelper.formatterName(schemaName);

					const fileName = `${kebabCase(formatterSchemaName)}.schema.ts`;

					const filePath = path.join(componentOutputDir, "models", fileName);

					const schemaSourceFile = project.createSourceFile(filePath, "", {
						overwrite: true,
					});
					const statements = buildSchemas(
						formatterSchemaName,
						schema,
						{
							...schemaRenderOptions(
								ctx,
								["components", "schemas", schemaName],
								unguardedRecursiveRefs,
							),
							lazyRefs: recursiveRefs,
							unguardedRecursiveRefs,
						},
						schemaName,
					);
					const selfRef = `#/components/schemas/${schemaName}`;
					const refs = collectRefsFromSchema(schema, {
						omitUnguardedRefsWithinOneOf: unguardedRecursiveRefs,
						refSemanticContext,
					}).filter((ref) => ref !== selfRef);
					const recursiveTypeRefs =
						recursiveRefs.has(selfRef) && !unguardedRecursiveRefs.has(selfRef)
							? recursiveRefs
							: undefined;

					const imports = buildRefImports(
						refs,
						filePath,
						componentOutputDir,
						pluginConfig?.importWithExtension,
						recursiveTypeRefs,
					);

					schemaSourceFile.addStatements([
						...imports,
						importZodTemplate,
						...statements,
					]);

					ctx.setSourceFiles(
						[pluginEnum.Zod, "componentsSchemas", schemaName],
						schemaSourceFile,
					);
				}
			},
			componentsParameters(parameters, ctx) {
				const { project, componentOutputDir, unguardedRecursiveRefs } =
					getState(ctx.openapiToSingleConfig);
				forEach(parameters, (parameter, parameterName) => {
					if (
						!("$ref" in parameter) &&
						Object.keys(parameter.content ?? {}).length > 1
					) {
						addInvalidContentDiagnostic(
							ctx,
							["components", "parameters", parameterName, "content"],
							"Parameter",
						);
					}
					const formatterParameterName =
						ctx.openapiHelper.formatterName(parameterName);

					const fileName = `${kebabCase(formatterParameterName)}.schema.ts`;

					const filePath = path.join(
						componentOutputDir,
						"parameters",
						fileName,
					);
					const parameterSourceFile = project.createSourceFile(filePath, "", {
						overwrite: true,
					});
					const statements = buildComponentParameters(
						parameter,
						formatterParameterName,
						schemaRenderOptions(
							ctx,
							["components", "parameters", parameterName],
							unguardedRecursiveRefs,
						),
					);
					if (!statements) {
						return;
					}
					const imports = buildRefImports(
						collectRefsFromComponentParameters(
							{
								[parameterName]: parameter,
							},
							{
								omitUnguardedRefsWithinOneOf: unguardedRecursiveRefs,
								refSemanticContext: {
									dialect: ctx.openAPIDialect,
									objectContext: "schema",
								},
							},
						),
						filePath,
						componentOutputDir,
						pluginConfig?.importWithExtension,
					);

					parameterSourceFile.addStatements([
						...imports,
						importZodTemplate,
						statements,
					]);

					ctx.setSourceFiles(
						[pluginEnum.Zod, "componentsParameters", parameterName],
						parameterSourceFile,
					);
				});
			},
			componentsRequestBodies(requestBodies, ctx) {
				const { project, componentOutputDir, unguardedRecursiveRefs } =
					getState(ctx.openapiToSingleConfig);
				// components.requestBodies
				for (const [requestBodyName, requestObject] of Object.entries(
					requestBodies,
				)) {
					if (ctx.openAPIDialect === "3.2") addMediaDiagnostics(ctx, inspectOpenAPI32MediaContent(ctx.openAPIDocument, requestObject, ["components", "requestBodies", requestBodyName]));
					if (
						!("$ref" in requestObject) &&
						Object.keys(requestObject.content ?? {}).length > 1
					) {
						addMultipleMediaDiagnostic(
							ctx,
							["components", "requestBodies", requestBodyName, "content"],
							Object.keys(requestObject.content ?? {}),
						);
					}
					const formatterName =
						ctx.openapiHelper.formatterName(requestBodyName);

					const refs = collectRefsFromComponentRequestBody(requestObject, {
						omitUnguardedRefsWithinOneOf: unguardedRecursiveRefs,
						refSemanticContext: {
							dialect: ctx.openAPIDialect,
							objectContext: "schema",
						},
					}, ctx.openAPIDialect === "3.2" ? ctx.openAPIDocument : undefined);

					const fileName = `${kebabCase(formatterName)}.schema.ts`;

					const filePath = path.join(
						componentOutputDir,
						"requestBodies",
						fileName,
					);
					const requestBodySourceFile = project.createSourceFile(filePath, "", {
						overwrite: true,
					});
					const statements = buildComponentsRequestBody(
						formatterName,
						requestObject,
						schemaRenderOptions(
							ctx,
							["components", "requestBodies", requestBodyName],
							unguardedRecursiveRefs,
						),
						...(ctx.openAPIDialect === "3.2" ? [ctx.openAPIDocument, ["components", "requestBodies", requestBodyName]] as const : []),
					);
					if (!statements) {
						return;
					}
					const imports = buildRefImports(
						refs,
						filePath,
						componentOutputDir,
						pluginConfig?.importWithExtension,
					);

					requestBodySourceFile.addStatements([
						...imports,
						importZodTemplate,
						statements,
					]);
					ctx.setSourceFiles(
						[pluginEnum.Zod, "componentsRequestBodies", requestBodyName],
						requestBodySourceFile,
					);
				}
			},
			componentsResponses(responses, ctx) {
				const { project, componentOutputDir, unguardedRecursiveRefs } =
					getState(ctx.openapiToSingleConfig);
				// components.responses
				forEach(responses, (response, responseName) => {
					if (ctx.openAPIDialect === "3.2") addMediaDiagnostics(ctx, inspectOpenAPI32MediaContent(ctx.openAPIDocument, response, ["components", "responses", responseName]));
					if (
						!("$ref" in response) &&
						Object.keys(response.content ?? {}).length > 1
					) {
						addMultipleMediaDiagnostic(
							ctx,
							["components", "responses", responseName, "content"],
							Object.keys(response.content ?? {}),
						);
					}
					const formatterResponse =
						ctx.openapiHelper.formatterName(responseName);

					const statements = buildComponentsResponse(
						response,
						formatterResponse,
						schemaRenderOptions(
							ctx,
							["components", "responses", responseName],
							unguardedRecursiveRefs,
						),
						...(ctx.openAPIDialect === "3.2" ? [ctx.openAPIDocument, ["components", "responses", responseName]] as const : []),
					);
					const headerDescriptor = describeResponseHeaders(
						response,
						ctx.openAPIDocument,
					);
					for (const header of headerDescriptor.headers) {
						if (header.invalidContent) {
							addInvalidContentDiagnostic(
								ctx,
								[
									"components",
									"responses",
									responseName,
									"headers",
									header.sourceName,
									"content",
								],
								"Header",
							);
						}
					}
					const headerStatement = headerDescriptor.headers.length
						? responseHeadersTemplate(
								headerDescriptor,
								`${getComponentExportName("responses", formatterResponse)}Headers`,
								schemaRenderOptions(
									ctx,
									["components", "responses", responseName, "headers"],
									unguardedRecursiveRefs,
								),
							)
						: undefined;

					const refs = collectRefsFromComponentResponse(
						response,
						ctx.openAPIDocument,
						{
							omitUnguardedRefsWithinOneOf: unguardedRecursiveRefs,
							refSemanticContext: {
								dialect: ctx.openAPIDialect,
								objectContext: "schema",
							},
						},
					);

					const fileName = `${kebabCase(formatterResponse)}.schema.ts`;

					const filePath = path.join(componentOutputDir, "responses", fileName);

					const responseSourceFile = project.createSourceFile(filePath, "", {
						overwrite: true,
					});

					if (!statements) {
						return;
					}
					const imports = buildRefImports(
						refs,
						filePath,
						componentOutputDir,
						pluginConfig?.importWithExtension,
					);

					responseSourceFile.addStatements([
						...imports,
						importZodTemplate,
						statements,
						...(headerStatement ? [headerStatement] : []),
					]);
					ctx.setSourceFiles(
						[pluginEnum.Zod, "componentsResponses", responseName],
						responseSourceFile,
					);
				});
			},
		},
	};
});
