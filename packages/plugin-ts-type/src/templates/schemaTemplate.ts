import { buildSchemaPropertiesTypes } from "@/builds/components/buildSchemaPropertiesTypes.ts";

import type { SchemaObjectAndJSONSchema } from "@/types.ts";
import { getUpperFirstRefAlias } from "@/utils/getUpperFirstRefAlias.ts";
import {
	getInlineEnumTypeName,
	getInlineSchemaContextName,
	type InlineEnumSourcePath,
	type InlineEnumSymbolResolver,
} from "@/utils/inlineEnumNaming.ts";
import { generateObjectType } from "@openapi-to/core/utils";

import type { Schema } from "@openapi-to/core";
import { isUndefined } from "lodash-es";
import { type SchemaObject, isRef } from "oas/types";

export function schemaTemplate(
	schema: Schema,
	propertyName: string,
	parentName?: string,
	inlineEnumSymbols?: InlineEnumSymbolResolver,
	inlineEnumSourcePath?: InlineEnumSourcePath,
): string {
	if (schema === true || isUndefined(schema)) return "unknown";
	if (schema === false) return "never";

	const contextName = getInlineSchemaContextName(parentName, propertyName);
	let baseType: string;
	const record = schema as SchemaObjectAndJSONSchema;
	const hasUnion =
		("oneOf" in record && Array.isArray(record.oneOf)) ||
		("anyOf" in record && Array.isArray(record.anyOf));
	const hasIntersection = "allOf" in record && Array.isArray(record.allOf);

	if (isRef(schema) || hasUnion || hasIntersection) {
		const members: string[] = [];
		if (isRef(schema)) members.push(refType(schema));
		if (hasUnion)
			members.push(
				unionType(
					record,
					propertyName,
					contextName,
					inlineEnumSymbols,
					inlineEnumSourcePath,
				),
			);
		if (hasIntersection)
			members.push(
				intersectionType(
					record,
					propertyName,
					contextName,
					inlineEnumSymbols,
					inlineEnumSourcePath,
				),
			);

		const structuralSibling = renderStructuralSibling(
			record,
			propertyName,
			parentName ?? "",
			inlineEnumSymbols,
			inlineEnumSourcePath,
		);
		if (structuralSibling) members.push(structuralSibling);

		baseType = members
			.map((member) =>
				members.length > 1 && member.includes(" | ") ? `(${member})` : member,
			)
			.join(" & ");
	} else if ("const" in schema) {
		baseType = renderConstType(schema.const);
	} else if (schema.enum && schema.enum.length > 0) {
		const legacyTypeName = getInlineEnumTypeName(parentName, propertyName);
		baseType =
			inlineEnumSymbols?.getTypeName(
				requireInlineEnumSourcePath(inlineEnumSourcePath, legacyTypeName),
				legacyTypeName,
			) ?? legacyTypeName;
	} else {
		baseType = resolveBaseType(
			schema,
			propertyName,
			contextName,
			inlineEnumSymbols,
			inlineEnumSourcePath,
		);
	}

	// 处理 nullable
	if ("nullable" in schema && schema.nullable === true) {
		return `${baseType.includes(" & ") ? `(${baseType})` : baseType} | null`;
	}

	return baseType;
}

// 处理引用
function refType(schema: { $ref: string }): string {
	return `${getUpperFirstRefAlias(schema.$ref)}`;
}

function renderStructuralSibling(
	schema: SchemaObjectAndJSONSchema,
	propertyName: string,
	parentName: string,
	inlineEnumSymbols?: InlineEnumSymbolResolver,
	inlineEnumSourcePath?: InlineEnumSourcePath,
): string | undefined {
	const sibling = { ...(schema as Record<string, unknown>) };
	delete sibling.$ref;
	delete sibling.oneOf;
	delete sibling.anyOf;
	delete sibling.allOf;
	delete sibling.nullable;

	if (
		sibling.type === undefined &&
		(sibling.properties !== undefined ||
			sibling.additionalProperties !== undefined)
	) {
		sibling.type = "object";
	}
	if (sibling.type === undefined && sibling.items !== undefined) {
		sibling.type = "array";
	}

	const hasStructuralKeyword = [
		"type",
		"properties",
		"items",
		"additionalProperties",
		"enum",
		"const",
	].some((key) => sibling[key] !== undefined);
	if (!hasStructuralKeyword) return undefined;

	const rendered = schemaTemplate(
		sibling as Schema,
		propertyName,
		parentName,
		inlineEnumSymbols,
		inlineEnumSourcePath,
	);
	return rendered === "unknown" ? undefined : rendered;
}

// union: oneOf / anyOf
function unionType(
	schemas: SchemaObjectAndJSONSchema,
	propertyName: string,
	parentName: string,
	inlineEnumSymbols?: InlineEnumSymbolResolver,
	inlineEnumSourcePath?: InlineEnumSourcePath,
): string {
	if (
		("oneOf" in schemas && schemas.oneOf) ||
		("anyOf" in schemas && schemas.anyOf)
	) {
		const types = (["oneOf", "anyOf"] as const).flatMap((key) =>
			(schemas[key] ?? []).map((schema, index) =>
				schemaTemplate(
					schema as SchemaObject,
					propertyName,
					parentName,
					inlineEnumSymbols,
					inlineEnumSourcePath
						? [...inlineEnumSourcePath, key, index]
						: undefined,
				),
			),
		);
		return types.join(" | ");
	}
	throw new Error(
		`Expected oneOf type for property "${propertyName}", but got "${"type" in schemas ? schemas.type : schemas}"`,
	);
}

// intersection: allOf
function intersectionType(
	schemas: SchemaObjectAndJSONSchema,
	propertyName: string,
	parentName: string,
	inlineEnumSymbols?: InlineEnumSymbolResolver,
	inlineEnumSourcePath?: InlineEnumSourcePath,
): string {
	if (!("allOf" in schemas && schemas.allOf)) {
		throw new Error(
			`Expected allOf type for property "${propertyName}", but got "${"type" in schemas ? schemas.type : schemas}"`,
		);
	}
	const types = schemas.allOf.map((s, index) =>
		schemaTemplate(
			s as SchemaObject,
			propertyName,
			parentName,
			inlineEnumSymbols,
			inlineEnumSourcePath
				? [...inlineEnumSourcePath, "allOf", index]
				: undefined,
		),
	);
	return types
		.map((type) => (type.includes(" | ") ? `(${type})` : type))
		.join(" & ");
}

// 基础类型
export function resolveBaseType(
	schema: Schema,
	propertyName: string,
	parentName: string,
	inlineEnumSymbols?: InlineEnumSymbolResolver,
	inlineEnumSourcePath?: InlineEnumSourcePath,
): string {
	if (schema === true) return "unknown";
	if (schema === false) return "never";
	const type = "type" in schema ? schema.type : "";
	if (Array.isArray(type)) {
		return type
			.map((member) => {
				if (member === "null") return "null";
				return resolveBaseType(
					{ ...schema, type: member } as Schema,
					propertyName,
					parentName,
					inlineEnumSymbols,
					inlineEnumSourcePath,
				);
			})
			.filter((member, index, members) => members.indexOf(member) === index)
			.join(" | ");
	}
	const numberTypes = [
		"int32",
		"int64",
		"float",
		"double",
		"integer",
		"long",
		"number",
		"int",
	];
	const stringTypes = ["string", "email", "password", "url", "byte", "binary"];
	switch (type) {
		case "boolean":
			return "boolean";

		case "string":
			return stringTypes.includes(("format" in schema && schema.format) || "")
				? "string"
				: "string";

		case "number":
		case "integer":
			return numberTypes.includes(("format" in schema && schema.format) || "")
				? "number"
				: "number";

		case "array":
			return resolveArrayType(
				schema,
				propertyName,
				parentName,
				inlineEnumSymbols,
				inlineEnumSourcePath,
			);

		case "object":
			return resolveObjectType(
				schema,
				parentName,
				inlineEnumSymbols,
				inlineEnumSourcePath,
			);

		case "null":
			return "null";

		default:
			return "unknown";
	}
}

// 数组类型
function resolveArrayType(
	schema: SchemaObjectAndJSONSchema,
	propertyName: string,
	parentName: string,
	inlineEnumSymbols?: InlineEnumSymbolResolver,
	inlineEnumSourcePath?: InlineEnumSourcePath,
): string {
	if ("type" in schema && schema.type !== "array") {
		throw new Error(
			`Expected array type for property "${propertyName}", but got "${schema.type}"`,
		);
	}

	if (!("items" in schema && schema.items)) return "unknown";

	const itemType = schemaTemplate(
		schema.items as SchemaObjectAndJSONSchema,
		propertyName,
		parentName,
		inlineEnumSymbols,
		inlineEnumSourcePath ? [...inlineEnumSourcePath, "items"] : undefined,
	);
	return `Array<${itemType}>`;
}

// 对象类型
function resolveObjectType(
	schema: Schema,
	parentName: string,
	inlineEnumSymbols?: InlineEnumSymbolResolver,
	inlineEnumSourcePath?: InlineEnumSourcePath,
): string {
	if (schema === true) return "unknown";
	if (schema === false) return "never";
	if (
		("properties" in schema && schema.properties) ||
		("additionalProperties" in schema &&
			schema.additionalProperties !== undefined) ||
		("required" in schema &&
			Array.isArray(schema.required) &&
			schema.required.some((name) => typeof name === "string"))
	) {
		const properties =
			buildSchemaPropertiesTypes(
				schema as SchemaObject,
				parentName,
				inlineEnumSymbols,
				inlineEnumSourcePath,
			) || [];
		return generateObjectType(properties);
	}
	return "Record<string, unknown>";
}

function requireInlineEnumSourcePath(
	sourcePath: InlineEnumSourcePath | undefined,
	legacyTypeName: string,
): InlineEnumSourcePath {
	if (sourcePath) return sourcePath;
	throw new Error(`Inline enum source path is missing for ${legacyTypeName}.`);
}

function renderConstType(value: unknown): string {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return JSON.stringify(value);
	}
	throw new Error(
		"TypeScript schema const currently supports only JSON scalar values.",
	);
}
