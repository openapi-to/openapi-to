import { createHash } from "node:crypto";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
	createPlugin,
	describeOperationResponses,
	inspectOpenAPI32OperationMedia,
	pluginEnum,
	selectSuccessResponseStatusCode,
	type HookContext,
	type OperationFakerResponse,
	type OperationWrapper,
} from "@openapi-to/core";
import {
	formatterModuleSpecifier,
	getRelativePath,
} from "@openapi-to/core/utils";
import { upperFirst } from "lodash-es";
import { Project, type SourceFile } from "ts-morph";
import type { PluginConfig } from "./types.ts";
import {
	renderSchema,
	type FakerDiagnostic,
	type SchemaRenderError,
} from "./schemaRenderer.ts";

type ComponentDescriptor = {
	schemaName: string;
	schema: unknown;
	sourceFile: SourceFile;
	typeName: string;
	factoryName: string;
	path: Array<string | number>;
};

type OperationDescriptor = {
	operation: OperationWrapper;
	statusCode: string;
	sourceStatusCode: string;
	classification: "success" | "error";
	selectedSuccessStatusCode?: string;
	mediaType?: string;
	kind: "schema" | "no-content";
	schema?: unknown;
	returnType: string;
	factoryName: string;
	path: Array<string | number>;
};

type PluginState = {
	project: Project;
	components: Map<string, ComponentDescriptor>;
	operations: Map<string, OperationDescriptor[]>;
};

const stateKey = Symbol("plugin-faker/state");
const reservedIdentifiers = new Set([
	"await",
	"break",
	"case",
	"catch",
	"class",
	"const",
	"continue",
	"debugger",
	"default",
	"delete",
	"do",
	"else",
	"enum",
	"export",
	"extends",
	"false",
	"finally",
	"for",
	"function",
	"if",
	"import",
	"in",
	"instanceof",
	"new",
	"null",
	"return",
	"super",
	"switch",
	"this",
	"throw",
	"true",
	"try",
	"typeof",
	"var",
	"void",
	"while",
	"with",
	"as",
	"implements",
	"interface",
	"let",
	"package",
	"private",
	"protected",
	"public",
	"static",
	"yield",
	"any",
	"boolean",
	"constructor",
	"declare",
	"get",
	"module",
	"require",
	"number",
	"set",
	"string",
	"symbol",
	"type",
	"from",
	"of",
]);

function stateFrom(store: Map<unknown, unknown>): PluginState {
	const state = store.get(stateKey);
	if (!state) throw new Error("Faker plugin state was not initialized.");
	return state as PluginState;
}

function stableHash(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 8);
}

function compare(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function safeIdentifier(value: string): boolean {
	return (
		/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) && !reservedIdentifiers.has(value)
	);
}

function mediaToken(mediaType: string): string {
	const parts = mediaType
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
	return parts.map(upperFirst).join("") || "Media";
}

function statusToken(statusCode: string): string {
	if (statusCode.toLowerCase() === "default") return "Default";
	return statusCode.toUpperCase();
}

function getExportedTypeName(
	sourceFile: SourceFile,
	expected: string,
): string | undefined {
	const declaration = [
		...sourceFile.getInterfaces(),
		...sourceFile.getTypeAliases(),
	].find((item) => item.isExported() && item.getName() === expected);
	return declaration?.getName();
}

function diagnostic(
	ctx: HookContext,
	code: string,
	severity: "error" | "warning",
	message: string,
	pathValue: Array<string | number>,
): void {
	ctx.addDiagnostic({
		code,
		severity,
		message,
		location: { path: pathValue },
		plugin: pluginEnum.Faker,
	});
}

function emitRendererDiagnostics(
	ctx: HookContext,
	diagnostics: FakerDiagnostic[],
): void {
	for (const item of diagnostics)
		diagnostic(ctx, item.code, item.severity, item.message, item.path);
}

function typeNameForOperation(
	operation: OperationWrapper,
	classification: "success" | "error",
): string | undefined {
	const type = operation.accessor.operationTSType;
	if (!type) return undefined;
	return classification === "success"
		? type.responseSuccess
		: type.responseError;
}

function describeOperation(
	operation: OperationWrapper,
	ctx: HookContext,
): OperationDescriptor[] {
	const result: OperationDescriptor[] = [];
	const mediaSemantics = inspectOpenAPI32OperationMedia(
		operation.accessor.operation,
		operation.sourcePath,
	);
	const responses = describeOperationResponses(operation.accessor.operation);
	const selectedSuccessStatusCode = selectSuccessResponseStatusCode(
		responses.map((response) => response.sourceStatusCode),
	);
	for (const response of responses) {
		const returnType = typeNameForOperation(operation, response.classification);
		if (!returnType || !operation.accessor.operationTSType?.filePath) {
			diagnostic(
				ctx,
				"FAKER_TS_TYPE_METADATA_MISSING",
				"error",
				"The TypeScript plugin did not provide the required operation response type metadata.",
				[...operation.sourcePath, "responses", response.sourceStatusCode],
			);
			continue;
		}
		if (response.kind === "no-content") {
			const name = `create${upperFirst(operation.accessor.operationName)}${statusToken(response.statusCode)}NoContentResponse`;
			result.push({
				operation,
				statusCode: response.statusCode,
				sourceStatusCode: response.sourceStatusCode,
				classification: response.classification,
				selectedSuccessStatusCode,
				kind: "no-content",
				returnType,
				factoryName: name,
				path: [...operation.sourcePath, "responses", response.sourceStatusCode],
			});
			continue;
		}
		if (response.kind === "unknown-media") {
			diagnostic(
				ctx,
				"FAKER_RESPONSE_MEDIA_UNSUPPORTED",
				"error",
				"The operation response media has no explicit schema value for a complete Faker factory.",
				[...operation.sourcePath, "responses", response.sourceStatusCode],
			);
			continue;
		}
		const mediaEntries = response.inspection?.length
			? response.inspection
			: [{ contentType: response.contentType, schema: response.schema }];
		const mediaRecords = mediaEntries.map((media) => ({
			media,
			token: media.contentType ? mediaToken(media.contentType) : "",
		}));
		const mediaTokenCounts = new Map<string, number>();
		for (const { token } of mediaRecords)
			mediaTokenCounts.set(token, (mediaTokenCounts.get(token) ?? 0) + 1);
		for (const { media, token: initialToken } of mediaRecords) {
			if (!media.contentType || media.schema === undefined) {
				diagnostic(
					ctx,
					"FAKER_RESPONSE_MEDIA_UNSUPPORTED",
					"error",
					"The operation response has no bounded media type schema supported by Faker v1.",
					[...operation.sourcePath, "responses", response.sourceStatusCode],
				);
				continue;
			}
			const mediaSemanticsEntry = mediaSemantics.find(
				(entry) =>
					entry.path.length === operation.sourcePath.length + 4 &&
					entry.path[operation.sourcePath.length] === "responses" &&
					String(entry.path[operation.sourcePath.length + 1]).toLowerCase() ===
						response.sourceStatusCode.toLowerCase() &&
					entry.path[operation.sourcePath.length + 3] === media.contentType,
			);
			const semantics = mediaSemanticsEntry?.semantics;
			if (
				mediaSemanticsEntry?.resolution === "unresolved" ||
				!semantics?.hasSchema ||
				semantics.hasItemSchema ||
				semantics.family === "sequential-json" ||
				semantics.family === "sse" ||
				semantics.encodingMode === "positional"
			) {
				diagnostic(
					ctx,
					"FAKER_RESPONSE_MEDIA_UNSUPPORTED",
					"error",
					"Streaming, item-level, unresolved, or positional response media cannot be represented as a complete Faker data-model value.",
					[
						...operation.sourcePath,
						"responses",
						response.sourceStatusCode,
						"content",
						media.contentType,
					],
				);
				continue;
			}
			const typeAuthoritySchema = response.contentType
				? (response.inspection?.find(
						(entry) => entry.contentType === response.contentType,
					)?.schema ?? response.schema)
				: response.schema;
			if (!isDeepStrictEqual(media.schema, typeAuthoritySchema)) {
				diagnostic(
					ctx,
					"FAKER_UNSUPPORTED_SCHEMA",
					"error",
					"The media schema differs from the schema represented by the TypeScript response type; this factory was omitted.",
					[
						...operation.sourcePath,
						"responses",
						response.sourceStatusCode,
						"content",
						media.contentType,
						"schema",
					],
				);
				continue;
			}
			const token =
				(mediaTokenCounts.get(initialToken) ?? 0) > 1
					? `${initialToken}${stableHash(media.contentType)}`
					: initialToken;
			const name = `create${upperFirst(operation.accessor.operationName)}${statusToken(response.statusCode)}${token}Response`;
			result.push({
				operation,
				statusCode: response.statusCode,
				sourceStatusCode: response.sourceStatusCode,
				classification: response.classification,
				selectedSuccessStatusCode,
				mediaType: media.contentType,
				kind: "schema",
				schema: media.schema,
				returnType,
				factoryName: name,
				path: [
					...operation.sourcePath,
					"responses",
					response.sourceStatusCode,
					"content",
					media.contentType,
					"schema",
				],
			});
		}
	}
	return result;
}

function addTypeImport(
	typeImports: Map<string, Map<string, string>>,
	targetPath: string,
	typeName: string,
): string {
	const entries = typeImports.get(targetPath) ?? new Map<string, string>();
	const existingForTarget = entries.get(typeName);
	if (existingForTarget) return existingForTarget;
	const existing = [...typeImports.values()].flatMap((types) => [
		...types.values(),
	]);
	const alias = existing.includes(typeName)
		? `${typeName}_${stableHash(targetPath)}`
		: typeName;
	entries.set(typeName, alias);
	typeImports.set(targetPath, entries);
	return alias;
}

export const definePlugin = createPlugin((pluginConfig?: PluginConfig) => ({
	name: pluginEnum.Faker,
	dependencies: [pluginEnum.TsType],
	hooks: {
		buildStart(ctx) {
			for (const operation of ctx.openapiHelper.getAllOperations())
				operation.accessor.clearOperationFaker();
			ctx.store.set(stateKey, {
				project: new Project(),
				components: new Map(),
				operations: new Map(),
			} satisfies PluginState);
		},
		componentsSchemas(schemas, ctx) {
			const state = stateFrom(ctx.store);
			for (const [schemaName, schema] of Object.entries(schemas)) {
				const pathValue = ["components", "schemas", schemaName];
				const sourceFile = ctx.getSourceFiles([
					pluginEnum.TsType,
					"componentsSchemas",
					schemaName,
				]);
				const formatted = ctx.openapiHelper.formatterName(schemaName);
				const expectedTypeName = `${upperFirst(formatted)}Model`;
				const typeName =
					sourceFile && getExportedTypeName(sourceFile, expectedTypeName);
				const factoryName = `create${upperFirst(formatted)}`;
				if (!sourceFile || !typeName) {
					diagnostic(
						ctx,
						"FAKER_TS_TYPE_METADATA_MISSING",
						"error",
						"The TypeScript plugin did not provide the component type artifact required by this factory.",
						pathValue,
					);
					continue;
				}
				state.components.set(schemaName, {
					schemaName,
					schema,
					sourceFile,
					typeName,
					factoryName,
					path: pathValue,
				});
			}
		},
		operation(operation, ctx) {
			const state = stateFrom(ctx.store);
			state.operations.set(
				operation.sourcePointer,
				describeOperation(operation, ctx),
			);
		},
		buildEnd(ctx) {
			const state = stateFrom(ctx.store);
			const components = [...state.components.values()].sort((left, right) =>
				compare(left.schemaName, right.schemaName),
			);
			const operations = [...state.operations.entries()]
				.sort(([left], [right]) => compare(left, right))
				.flatMap(([, descriptors]) => descriptors);
			const all = [
				...components.map((item) => ({
					name: item.factoryName,
					path: item.path,
					kind: "component" as const,
					item,
				})),
				...operations.map((item) => ({
					name: item.factoryName,
					path: item.path,
					kind: "operation" as const,
					item,
				})),
			];
			const nameGroups = new Map<string, typeof all>();
			for (const item of all) {
				const group = nameGroups.get(item.name) ?? [];
				group.push(item);
				nameGroups.set(item.name, group);
			}
			const collisions = new Set<string>();
			for (const [name, group] of nameGroups) {
				if (group.length > 1 || !safeIdentifier(name)) {
					collisions.add(name);
					for (const item of group)
						diagnostic(
							ctx,
							"FAKER_FACTORY_NAME_COLLISION",
							"error",
							"Generated factory names collide or are not valid TypeScript identifiers.",
							item.path,
						);
				}
			}
			const typeImports = new Map<string, Map<string, string>>();
			const functions: Array<{
				name: string;
				type: string;
				expression: string;
				path: Array<string | number>;
			}> = [];
			for (const item of all) {
				if (collisions.has(item.name)) continue;
				if (item.kind === "component") {
					const target = item.item.sourceFile.getFilePath();
					const type = addTypeImport(typeImports, target, item.item.typeName);
					try {
						const rendered = renderSchema(
							item.item.schema,
							ctx.openAPIDocument,
							item.path,
						);
						emitRendererDiagnostics(ctx, rendered.diagnostics);
						functions.push({
							name: item.name,
							type,
							expression: rendered.expression,
							path: item.path,
						});
					} catch (error) {
						const failure = error as SchemaRenderError;
						diagnostic(
							ctx,
							failure.code ?? "FAKER_UNSUPPORTED_SCHEMA",
							"error",
							failure.message,
							failure.path ?? item.path,
						);
					}
				} else {
					const typeFilePath =
						item.item.operation.accessor.operationTSType?.filePath;
					if (!typeFilePath) continue;
					const type = addTypeImport(
						typeImports,
						typeFilePath,
						item.item.returnType,
					);
					if (item.item.kind === "no-content") {
						functions.push({
							name: item.name,
							type,
							expression: "undefined",
							path: item.path,
						});
					} else {
						try {
							const rendered = renderSchema(
								item.item.schema,
								ctx.openAPIDocument,
								item.path,
							);
							emitRendererDiagnostics(ctx, rendered.diagnostics);
							functions.push({
								name: item.name,
								type,
								expression: rendered.expression,
								path: item.path,
							});
						} catch (error) {
							const failure = error as SchemaRenderError;
							diagnostic(
								ctx,
								failure.code ?? "FAKER_UNSUPPORTED_SCHEMA",
								"error",
								failure.message,
								failure.path ?? item.path,
							);
						}
					}
				}
			}
			if (functions.length === 0) return;
			const filePath = path.join(
				ctx.openapiToSingleConfig.output.dir,
				"faker",
				"factories.ts",
			);
			const sourceFile = state.project.createSourceFile(filePath, "", {
				overwrite: true,
			});
			sourceFile.addImportDeclaration({
				isTypeOnly: true,
				moduleSpecifier: "@faker-js/faker",
				namedImports: ["Faker"],
			});
			for (const [targetPath, types] of [...typeImports.entries()].sort(
				([left], [right]) => compare(left, right),
			)) {
				sourceFile.addImportDeclaration({
					isTypeOnly: true,
					moduleSpecifier: formatterModuleSpecifier(
						getRelativePath(filePath, targetPath),
						pluginConfig?.importWithExtension,
					),
					namedImports: [...types.entries()]
						.sort(([left], [right]) => compare(left, right))
						.map(([name, alias]) => ({
							name,
							...(name === alias ? {} : { alias }),
						})),
				});
			}
			for (const fn of functions) {
				sourceFile.addFunction({
					name: fn.name,
					isExported: true,
					parameters: [{ name: "faker", type: "Faker" }],
					returnType: fn.type,
					statements: `return ${fn.expression};`,
				});
			}
			ctx.setSourceFiles([pluginEnum.Faker, "factories"], sourceFile);
			const metadata = new Map<OperationWrapper, OperationFakerResponse[]>();
			for (const item of operations) {
				if (
					collisions.has(item.factoryName) ||
					!functions.some((fn) => fn.name === item.factoryName)
				)
					continue;
				const values = metadata.get(item.operation) ?? [];
				values.push({
					statusCode: item.statusCode,
					sourceStatusCode: item.sourceStatusCode,
					classification: item.classification,
					...(item.mediaType ? { mediaType: item.mediaType } : {}),
					kind: item.kind,
					factoryName: item.factoryName,
				});
				metadata.set(item.operation, values);
			}
			for (const [operation, responses] of metadata) {
				const operationDescriptors = operations.filter(
					(item) => item.operation === operation,
				);
				const selectedStatus =
					operationDescriptors[0]?.selectedSuccessStatusCode;
				const responseSuccess = operationDescriptors.find(
					(item) =>
						item.classification === "success" &&
						item.statusCode === selectedStatus &&
						functions.some((fn) => fn.name === item.factoryName),
				)?.factoryName;
				operation.accessor.setOperationFaker({
					filePath,
					responseSuccess: responseSuccess ?? "",
					responses,
				});
			}
		},
	},
}));
