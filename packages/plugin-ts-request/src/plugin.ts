import path from "node:path";
import type { OpenapiToSingleConfig } from "@openapi-to/core";
import { createPlugin, describeOperationResponses, operationSourcePath, pluginEnum } from "@openapi-to/core";
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
import { querystringTransportIssue } from './builds/querystringRuntime.ts';
import { unsupportedMedia } from "./builds/mediaRuntime.ts";
import { FETCH_RUNTIME_NAME, fetchRuntimeSource } from "./builds/fetchRuntime.ts";
import { jsDocTemplateFromMethod } from "./template/jsDocTemplateFromMethod.ts";
import type { PluginConfig, RequiredPluginConfig } from "./types.ts";

const stateMap = new WeakMap<
	OpenapiToSingleConfig,
	{
		project: Project;
		pluginConfig: RequiredPluginConfig;
		fetchGenerated: boolean;
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
				const fetchInvalid = _pluginConfig?.requestClient === "fetch" && (
					_pluginConfig.requestImportDeclaration !== undefined ||
					_pluginConfig.requestConfigTypeImportDeclaration !== undefined ||
					_pluginConfig.dataReturnType !== undefined ||
					_pluginConfig.cookieTransport === "header"
				);
				if (fetchInvalid) ctx.addDiagnostic({ code: "TS_REQUEST_FETCH_CONFIG_UNSUPPORTED", severity: "error", message: "Fetch transport cannot use legacy request import, config type import, dataReturnType, or Cookie header configuration.", plugin: pluginEnum.Request });
				stateMap.set(ctx.openapiToSingleConfig, {
					project: new Project(),
					fetchGenerated: false,
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
						cookieTransport: _pluginConfig?.cookieTransport,
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
				operation.accessor.clearOperationRequest();
				if (pluginConfig.requestClient === "fetch") {
					if (_pluginConfig?.requestImportDeclaration || _pluginConfig?.requestConfigTypeImportDeclaration || _pluginConfig?.dataReturnType !== undefined || _pluginConfig?.cookieTransport === "header") return;
					if (operation.accessor.hasCookieParameters) {
						ctx.addDiagnostic({ code: "TS_REQUEST_FETCH_COOKIE_UNSUPPORTED", severity: "error", message: "Fetch transport does not support typed OpenAPI Cookie parameters.", location: { path: operationSourcePath(operation) }, plugin: pluginEnum.Request });
						return;
					}
					const method = (operation.wireMethod ?? operation.method).toUpperCase();
					if ((method === "GET" || method === "HEAD") && operation.accessor.hasRequestBody) {
						ctx.addDiagnostic({ code: "TS_REQUEST_FETCH_BODY_METHOD_UNSUPPORTED", severity: "error", message: "Fetch transport does not support request bodies for GET or HEAD operations.", location: { path: operationSourcePath(operation) }, plugin: pluginEnum.Request });
						return;
					}
					if (operation.accessor.hasRequestBody) {
						const bodyMedia = operation.accessor.operation.getContentType().toLowerCase().split(";", 1)[0]?.trim() ?? "";
						const declaredBodyMedia = Object.keys(((operation.accessor.operation.schema as { requestBody?: { content?: Record<string, unknown> } } | undefined)?.requestBody?.content ?? {}));
						if (declaredBodyMedia.length > 1) {
							ctx.addDiagnostic({ code: "TS_REQUEST_FETCH_BODY_MEDIA_AMBIGUOUS", severity: "error", message: "Fetch transport requires one declared request body media type per operation.", location: { path: operationSourcePath(operation) }, plugin: pluginEnum.Request });
							return;
						}
						if (!(bodyMedia === "application/json" || bodyMedia.endsWith("+json") || bodyMedia.startsWith("text/") || bodyMedia === "application/x-www-form-urlencoded" || bodyMedia === "multipart/form-data")) {
							ctx.addDiagnostic({ code: "TS_REQUEST_FETCH_BODY_UNSUPPORTED", severity: "error", message: "Fetch transport does not support this request body media type.", location: { path: operationSourcePath(operation) }, plugin: pluginEnum.Request });
							return;
						}
					}
					const mediaIssue = fetchResponseMediaIssue(operation);
					if (mediaIssue) {
						ctx.addDiagnostic({ code: "TS_REQUEST_FETCH_RESPONSE_MEDIA_UNSUPPORTED", severity: "error", message: mediaIssue, location: { path: operationSourcePath(operation) }, plugin: pluginEnum.Request });
						return;
					}
					if (operation.accessor.queryParameters.some((parameter) => (parameter.style ?? "form") !== "form" || (parameter.explode ?? true) !== true)) {
						ctx.addDiagnostic({ code: "TS_REQUEST_FETCH_QUERY_STYLE_UNSUPPORTED", severity: "error", message: "Fetch transport supports only form-style exploded query parameters.", location: { path: operationSourcePath(operation) }, plugin: pluginEnum.Request });
						return;
					}
				}
				if (ctx.openAPIDialect === "3.2") {
					const unsupported = unsupportedMedia(operation);
					if (unsupported) {
						ctx.addDiagnostic({ code: "TS_REQUEST_MEDIA_RUNTIME_UNSUPPORTED", severity: "error", message: "OpenAPI 3.2 media requires a transport codec unavailable in this plugin.", location: { path: unsupported.path }, plugin: pluginEnum.Request });
						return;
					}
				}
				if (operation.accessor.hasQuerystringParameter) {
					const issue = querystringTransportIssue(operation);
					if (issue) {
						ctx.addDiagnostic({ code: 'TS_REQUEST_QUERYSTRING_UNSUPPORTED', severity: 'error', message: issue, location: { path: operationSourcePath(operation) }, plugin: pluginEnum.Request });
						return;
					}
				}
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

				const runtimeFilePath = path.join(ctx.openapiToSingleConfig.output.dir, FETCH_RUNTIME_NAME);
				operation.accessor.setOperationRequest({
					filePath,
					requestName,
					...(pluginConfig.requestClient === "fetch" ? { transport: "fetch" as const, requestConfigTypeName: "FetchRequestConfig", responseErrorTypeName: "FetchRequestError", runtimeFilePath } : {}),
				});

				const operationSourceFile = project.createSourceFile(filePath, "", {
					overwrite: true,
				});

				const operationType = operation.accessor.operationTSType;
				const operationZodSchema = operation.accessor.operationZodSchema;
				const imports = buildImports(
					[
						{
							kind: StructureKind.ImportDeclaration,
							isTypeOnly: true,
							namedImports: [
								operationType?.requestInput,
								operation.accessor.hasQueryParametersArray
									? operationType?.queryParams
									: undefined,
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
											operation.accessor.hasHeaderParameters
												? operationZodSchema?.headerParams
												: undefined,
											operation.accessor.hasCookieParameters
												? operationZodSchema?.cookieParams
												: undefined,
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
				);
				if (pluginConfig.requestClient === "fetch") {
					const runtimeSpecifier = formatterModuleSpecifier(getRelativePath(filePath, runtimeFilePath), pluginConfig.importWithExtension);
					imports.push({ kind: StructureKind.ImportDeclaration, namedImports: ["FetchTransportError", "callFetch", "encodeFetchMultipart", "encodeFetchUrlForm", "resolveFetchUrl", "serializeFetchHeaderParameters", "serializeFetchQuery"], moduleSpecifier: runtimeSpecifier });
					imports.push({ kind: StructureKind.ImportDeclaration, isTypeOnly: true, namedImports: ["FetchRequestConfig"], moduleSpecifier: runtimeSpecifier });
					state.fetchGenerated = true;
				}
				if (
					pluginConfig.requestClient === "axios" &&
					(operation.accessor.hasHeaderParameters ||
						operation.accessor.hasCookieParameters ||
						!operation.accessor.isJsonContainsDefaultCases)
				) {
					imports.push({
						kind: StructureKind.ImportDeclaration,
						namedImports: ["AxiosHeaders"],
						moduleSpecifier: "axios",
					});
				}
				operationSourceFile.addStatements(imports);
				operationSourceFile.addFunction(statement);
				ctx.setSourceFiles(
					[pluginEnum.Request, operation.accessor.operationName],
					operationSourceFile,
				);
			},
			tagEnd: async () => {},
			buildEnd: async (ctx) => {
				const state = stateMap.get(ctx.openapiToSingleConfig);
				if (!state?.fetchGenerated) return;
				const filePath = path.join(ctx.openapiToSingleConfig.output.dir, FETCH_RUNTIME_NAME);
				const runtimeFile = state.project.createSourceFile(filePath, fetchRuntimeSource, { overwrite: true });
				ctx.setSourceFiles([pluginEnum.Request, "fetch-runtime"], runtimeFile);
			},
		},
	};
});

function fetchResponseMediaIssue(operation: import("@openapi-to/core").OperationWrapper): string | undefined {
	const binary = new Set(["application/octet-stream", "application/pdf", "application/zip", "application/vnd.ms-excel", "application/msword", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "image/jpeg", "image/png", "image/gif", "audio/mpeg", "video/mp4"]);
	for (const content of describeOperationResponses(operation.accessor.operation).flatMap((response) => response.inspection?.map(({ contentType }) => contentType).filter((value): value is string => Boolean(value)) ?? [])) {
		const media = content.toLowerCase().split(";", 1)[0]?.trim() ?? "";
		if (media === "application/json" || media === "application/*+json" || /^application\/[!#$%&'*+.^_`|~0-9a-z-]+\+json$/.test(media) || media.startsWith("text/") || binary.has(media)) continue;
		return "Fetch transport does not support every declared response media type for this operation.";
	}
	return undefined;
}
