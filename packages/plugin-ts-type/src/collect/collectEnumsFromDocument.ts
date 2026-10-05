import {
	type ComponentsParameters,
	type ComponentsResponsesValue,
	type ComponentsSchema,
	describeResponse,
	inspectOpenAPI32MediaContent,
	type ParameterObjectWithRef,
	resolveParameterSchema,
	type Schema,
} from "@openapi-to/core";
import { isBoolean, isPlainObject, upperFirst } from "lodash-es";
import type { MediaTypeObject } from "oas/types";
import type { OpenAPIV3, OpenAPIV3_1 } from "openapi-types";
import type { EnumItem } from "@/EnumRegistry.ts";
import {
	getInlineSchemaContextName,
	type InlineEnumSource,
	type InlineEnumSourcePath,
} from "@/utils/inlineEnumNaming.ts";

type Reference = OpenAPIV3.ReferenceObject;
export type CollectedEnumItem = Omit<EnumItem, "sourcePath"> & InlineEnumSource;

export const collectEnumsFromPathParameters = (
	parameters: ParameterObjectWithRef[],
	operationName: string,
	operationSourcePath: InlineEnumSourcePath = ["operations", operationName],
): CollectedEnumItem[] => {
	return parameters.flatMap((parameter) => {
		const schema = resolveParameterSchema(parameter) || {};
		if (typeof schema !== "object") return [];
		const name = `${operationName}${upperFirst(parameter.name)}`;
		return collectEnumsFromSchema(
			schema,
			name,
			[],
			[
				...operationSourcePath,
				"parameters",
				parameter.in,
				parameter.name,
				"schema",
			],
		);
	});
};

export const collectEnumsFromPathRequestBodies = (
	requestBodies:
		| MediaTypeObject
		| false
		| [string, MediaTypeObject, ...string[]],
	contextName: string,
	operationSourcePath: InlineEnumSourcePath = ["operations", contextName],
): CollectedEnumItem[] => {
	if (requestBodies === false) return [];
	if (Array.isArray(requestBodies)) {
		const [contentType, media] = requestBodies;

		if (media?.schema)
			return collectEnumsFromSchema(
				media.schema,
				contextName,
				[],
				[
					...operationSourcePath,
					"requestBody",
					"content",
					contentType,
					"schema",
				],
			);
	} else if (requestBodies) {
		if (requestBodies.schema)
			return collectEnumsFromSchema(
				requestBodies.schema,
				contextName,
				[],
				[...operationSourcePath, "requestBody", "schema"],
			);
	}
	return [];
};

type Responses =
	| {
			description?: string;
			label: string;
			schema: Schema;
			type: string | string[];
	  }[]
	| null;
export const collectEnumsFromPathResponses = (
	responses: Responses,
	contextName: string,
	responseSourcePath: InlineEnumSourcePath = ["operations", contextName, "responses"],
	contentTypes: readonly string[] = [],
): CollectedEnumItem[] => {
	if (!responses) {
		return [];
	}

	return responses.flatMap((response, index) => {
		const name = `${contextName}${upperFirst(response.label)}`;
		return collectEnumsFromSchema(
			response.schema,
			name,
			[],
			[
				...responseSourcePath,
				"content",
				contentTypes[index] ?? response.label,
				"schema",
			],
		);
	});
};

export const collectEnumsFromComponentParameters = (
	parameters: ComponentsParameters,
	formatName: (name: string) => string = (name) => name,
): CollectedEnumItem[] => {
	const enums: CollectedEnumItem[] = [];
	for (const [name, parameter] of Object.entries(parameters)) {
		if ("$ref" in parameter) continue;
		const schema = resolveParameterSchema(parameter);
		if (schema !== undefined)
			enums.push(
				...collectEnumsFromSchema(
					schema,
					`Parameter${upperFirst(formatName(name))}Model`,
					[],
					["components", "parameters", name, "schema"],
				),
			);
	}
	return enums;
};

export const collectEnumsFromComponentRequestBody = (
	rb: OpenAPIV3.RequestBodyObject | OpenAPIV3_1.RequestBodyObject | Reference,
	name: string,
	sourceName: string = name,
	document?: unknown,
): CollectedEnumItem[] => {
	if ("$ref" in rb) return [];
	if (document) {
		const entries = inspectOpenAPI32MediaContent(document, rb, ["components", "requestBodies", sourceName]);
		if (entries.some((entry) => !entry.semantics || entry.semantics.hasItemSchema)) return [];
		return entries.flatMap((entry) => entry.mediaObject?.schema === undefined ? [] : collectEnumsFromSchema(entry.mediaObject.schema as Schema, name, [], [...entry.path, "schema"]));
	}
	const enums: CollectedEnumItem[] = [];
	for (const contentType in rb.content) {
		const media = rb.content[contentType];
		if (media?.schema)
			enums.push(
				...collectEnumsFromSchema(media.schema, name, [], [
					"components",
					"requestBodies",
					sourceName,
					"content",
					contentType,
					"schema",
				]),
			);
	}
	return enums;
};

export const collectEnumsFromComponentResponse = (
	response: ComponentsResponsesValue,
	contextName: string,
	sourceName: string = contextName,
	document?: unknown,
): CollectedEnumItem[] => {
	if ("$ref" in response) return [];
	if (document) {
		const entries = inspectOpenAPI32MediaContent(document, response, ["components", "responses", sourceName]);
		if (entries.some((entry) => !entry.semantics || entry.semantics.hasItemSchema)) return [];
		return entries.flatMap((entry) => entry.mediaObject?.schema === undefined ? [] : collectEnumsFromSchema(entry.mediaObject.schema as Schema, contextName, [], [...entry.path, "schema"]));
	}
	const descriptor = describeResponse(response);
	if (descriptor.schema === undefined || !descriptor.contentType) return [];
	return collectEnumsFromSchema(descriptor.schema, contextName, [], [
		"components",
		"responses",
		sourceName,
		"content",
		descriptor.contentType,
		"schema",
	]);
};

export const collectEnumsFromComponentSchema = (
	schema: ComponentsSchema,
	name: string,
	sourceName: string = name,
): CollectedEnumItem[] => {
	return collectEnumsFromSchema(schema, name, [], [
		"components",
		"schemas",
		sourceName,
	]);
};

export function collectEnumsFromSchema(
	schema: Schema,
	contextName: string,
	enums: CollectedEnumItem[] = [],
	sourcePath: InlineEnumSourcePath = [contextName],
): CollectedEnumItem[] {
	if (!schema || typeof schema !== "object") return enums;
	const record = schema as Record<string, unknown>;

	if (Array.isArray(record.enum)) {
		const enumName = `${contextName}`;

		enums.push({
			name: enumName,
			enumValue: record.enum,
			sourcePath,
			description:
				typeof record.description === "string" ? record.description : undefined,
		});
	}

	if (isPlainObject(record.properties)) {
		for (const [propName, propSchema] of Object.entries(
			record.properties as Record<string, unknown>,
		)) {
			if (typeof propSchema === "boolean" || isPlainObject(propSchema)) {
				collectEnumsFromSchema(
					propSchema as Schema,
					getInlineSchemaContextName(contextName, propName),
					enums,
					[...sourcePath, "properties", propName],
				);
			}
		}
	}

	for (const key of ["allOf", "anyOf", "oneOf"] as const) {
		const arr = record[key];
		if (Array.isArray(arr)) {
			arr.forEach((item, idx) => {
				if (typeof item === "boolean" || isPlainObject(item)) {
					collectEnumsFromSchema(
						item as Schema,
						`${contextName}_${key}_${idx}`,
						enums,
						[...sourcePath, key, idx],
					);
				}
			});
		}
	}

	if (record.items && typeof record.items === "object") {
		const items = record.items;
		if (isPlainObject(items)) {
			collectEnumsFromSchema(items as Schema, contextName, enums, [
				...sourcePath,
				"items",
			]);
		}

		if (Array.isArray(items)) {
			items.forEach((item, index) => {
				if (!isBoolean(item)) {
					collectEnumsFromSchema(item as Schema, contextName, enums, [
						...sourcePath,
						"items",
						index,
					]);
				}
			});
		}
	}

	if (
		record.additionalProperties &&
		typeof record.additionalProperties === "object"
	) {
		collectEnumsFromSchema(
			record.additionalProperties as Schema,
			contextName,
			enums,
			[...sourcePath, "additionalProperties"],
		);
	}
	return enums;
}
