import path from "node:path";
import type { OpenapiToSingleConfig } from "@openapi-to/core";
import {
	createPlugin,
	describeOperationResponses,
	type Diagnostic,
	operationSourcePath,
	pluginEnum,
	selectSuccessResponseStatusCode,
	type OperationWrapper,
	type OperationFakerResponse,
} from "@openapi-to/core";
import { kebabCase } from "lodash-es";
import { Project, StructureKind } from "ts-morph";
import { buildEnabled } from "./builds/buildEnabled.ts";
import { buildImports } from "./builds/buildImports.ts";
import { buildMethodBody } from "./builds/buildMethodBody.ts";
import { buildMethodParameters } from "./builds/buildMethodParameters.ts";
import { unsupportedMedia } from "./builds/mediaRuntime.ts";
import { getMswHandlerMethod } from "./builds/mswHandlerMethod.ts";
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
			pluginEnum.TsType,
			...(_pluginConfig?.responseDefaultType === "faker"
				? [pluginEnum.Faker]
				: []),
		],
		name: pluginEnum.MSW,
		hooks: {
			buildStart: async (ctx) => {
				// 可注入日志、校验 pluginConfig
				// ctx.logger.info('Request 插件启动', pluginConfig)
				stateMap.set(ctx.openapiToSingleConfig, {
					project: new Project(),
					pluginConfig: {
						importWithExtension: _pluginConfig?.importWithExtension ?? true,
						responseDefaultType: _pluginConfig?.responseDefaultType || "",
					},
				});
			},
			tagStart: async (_tagData, _ctx) => {},
			operation: async (operation, ctx) => {
				if (ctx.openAPIDialect === "3.2") {
					const unsupported = unsupportedMedia(operation);
					if (unsupported) {
						ctx.addDiagnostic({ code: "MSW_MEDIA_RUNTIME_UNSUPPORTED", severity: "error", message: "OpenAPI 3.2 media requires a transport codec unavailable in this plugin.", location: { path: unsupported.path }, plugin: pluginEnum.MSW });
						return;
					}
				}
				if (!getMswHandlerMethod(operation)) {
					ctx.addDiagnostic({
						code: "MSW_UNSUPPORTED_METHOD",
						severity: "error",
						message: `MSW generation cannot register an exact handler for HTTP method ${operation.wireMethod}.`,
						location: { path: operationSourcePath(operation) },
						plugin: pluginEnum.MSW,
					});
					return;
				}
				const state = stateMap.get(ctx.openapiToSingleConfig);
				if (!state) throw new Error("MSW plugin state not found");
				const { project, pluginConfig } = state;
				const fakerResponse =
					pluginConfig.responseDefaultType === "faker"
						? selectFakerResponse(operation, ctx)
						: undefined;
				if (
					pluginConfig.responseDefaultType === "faker" &&
					!fakerResponse
				) {
					return;
				}
				const requestName = `${operation.accessor.operationName}Handler`;

				const filePath = path.join(
					ctx.openapiToSingleConfig.output.dir,
					kebabCase(operation.tagName),
					`${kebabCase(operation.accessor.operationName)}.handler.ts`,
				);

				operation.accessor.setOperationRequest({
					filePath,
					requestName,
				});

				const operationSourceFile = project.createSourceFile(filePath, "", {
					overwrite: true,
				});

				operationSourceFile.addStatements(
					buildImports(operation, pluginConfig, filePath, fakerResponse),
				);

				operationSourceFile.addStatements([buildEnabled()]);

				operationSourceFile.addFunction({
					kind: StructureKind.Function,
					isAsync: false,
					name: requestName,
					parameters: buildMethodParameters(
						operation,
						pluginConfig,
						fakerResponse,
					),
					returnType: undefined,
					isDefaultExport: true,
					docs: jsDocTemplateFromMethod(operation),
					statements: buildMethodBody(
						operation,
						pluginConfig,
						fakerResponse?.statusCode,
					),
				});

				ctx.setSourceFiles(
					[pluginEnum.MSW, operation.accessor.operationName],
					operationSourceFile,
				);
			},
			tagEnd: async (_tagData, _ctx) => {},
		},
	};
});

function selectFakerResponse(
	operation: OperationWrapper,
	ctx: { addDiagnostic: (diagnostic: Diagnostic) => void },
): OperationFakerResponse | undefined {
	const describedResponses = describeOperationResponses(
		operation.accessor.operation,
	);
	const successResponses = describedResponses.filter(
		(response) => response.classification === "success",
	);
	const selectedStatusCode = selectSuccessResponseStatusCode(
		successResponses.map(({ statusCode }) => statusCode),
	);
	if (!selectedStatusCode) {
		ctx.addDiagnostic({
			code: "MSW_FAKER_RESPONSE_UNAVAILABLE",
			severity: "error",
			message: "No canonical success response is available for a Faker default.",
			location: { path: operationSourcePath(operation) },
			plugin: pluginEnum.MSW,
		});
		return undefined;
	}
	const selectedDescriptor = successResponses.find(
		(response) => response.statusCode === selectedStatusCode,
	);
	const statusLocation = {
		path: [
			...operationSourcePath(operation),
			"responses",
			selectedDescriptor?.sourceStatusCode ?? selectedStatusCode,
		],
	};
	if (
		!/^2[0-9]{2}$/.test(selectedStatusCode) ||
		selectedStatusCode === "204" ||
		selectedStatusCode === "205"
	) {
		ctx.addDiagnostic({
			code: "MSW_FAKER_STATUS_UNSUPPORTED",
			severity: "error",
			message: `Faker defaults require a body-capable concrete 2xx status; ${selectedStatusCode} is unsupported.`,
			location: statusLocation,
			plugin: pluginEnum.MSW,
		});
		return undefined;
	}

	const operationFaker = operation.accessor.operationFaker;
	if (!operationFaker?.filePath || !operationFaker.responses) {
		ctx.addDiagnostic({
			code: "MSW_FAKER_METADATA_MISSING",
			severity: "error",
			message: "Faker response metadata is unavailable for the selected success response.",
			location: statusLocation,
			plugin: pluginEnum.MSW,
		});
		return undefined;
	}

	const metadata = operationFaker.responses.filter(
		(response) =>
			response.classification === "success" &&
			response.statusCode === selectedStatusCode &&
			response.kind === "schema" &&
			typeOfJsonMedia(response.mediaType),
	);
	const exactJson = metadata.filter(
		(response) => response.mediaType?.toLowerCase() === "application/json",
	);
	const selected =
		exactJson.length === 1
			? exactJson[0]
			: metadata.length === 1
				? metadata[0]
				: undefined;
	if (!selected) {
		const code =
			metadata.length > 1
				? "MSW_FAKER_RESPONSE_AMBIGUOUS"
				: "MSW_FAKER_RESPONSE_UNAVAILABLE";
		const message = metadata.length > 1
			? "Multiple JSON-like Faker factories match the selected success response."
			: selectedDescriptor?.kind === "no-content"
				? "No-content responses cannot provide a JSON Faker default."
				: "No compatible JSON Faker factory matches the selected success response.";
		ctx.addDiagnostic({
			code,
			severity: "error",
			message,
			location: { path: [...statusLocation.path, "content"] },
			plugin: pluginEnum.MSW,
		});
		return undefined;
	}
	return selected;
}

function typeOfJsonMedia(mediaType: string | undefined): boolean {
	if (!mediaType) return false;
	const normalized = mediaType.toLowerCase();
	return normalized === "application/json" || normalized.endsWith("+json");
}
