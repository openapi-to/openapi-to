import type { Schema } from "@openapi-to/core";
import {
	getComponentRefExportName,
	getComponentRefOutputTypeName,
} from "@/utils/componentNaming.ts";

type SchemaRecord = Record<string, unknown>;

export type RecursiveSchemaTypeOptions = {
	lazyRefs: ReadonlySet<string>;
	fallbackToUnknown?: boolean;
};

function isRecord(value: unknown): value is SchemaRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parenthesize(type: string): string {
	return type.includes(" | ") || type.includes(" & ") ? `(${type})` : type;
}

function literalType(value: unknown): string {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean" ||
		(typeof value === "number" && Number.isFinite(value))
	) {
		return JSON.stringify(value);
	}
	return "never";
}

function refType(
	ref: string,
	options: RecursiveSchemaTypeOptions,
): string {
	if (options.lazyRefs.has(ref)) {
		return getComponentRefOutputTypeName(ref);
	}
	return `z.infer<typeof ${getComponentRefExportName(ref)}>`;
}

function unionType(
	schemas: unknown[],
	options: RecursiveSchemaTypeOptions,
): string {
	if (schemas.length === 0) return "never";
	return schemas
		.map((schema) => renderRecursiveSchemaType(schema as Schema, options))
		.join(" | ");
}

function intersectionType(
	schemas: unknown[],
	options: RecursiveSchemaTypeOptions,
): string {
	if (schemas.length === 0) return "never";
	return schemas
		.map((schema) =>
			parenthesize(renderRecursiveSchemaType(schema as Schema, options)),
		)
		.join(" & ");
}

function objectType(
	schema: SchemaRecord,
	options: RecursiveSchemaTypeOptions,
): string {
	const properties = isRecord(schema.properties) ? schema.properties : {};
	const required = new Set(
		Array.isArray(schema.required)
			? schema.required.filter(
					(name): name is string => typeof name === "string",
				)
			: [],
	);
	const entries = Object.entries(properties);
	const renderedEntries = entries.map(([name, propertySchema]) => ({
		name,
		required: required.has(name),
		type: renderRecursiveSchemaType(propertySchema as Schema, options),
	}));
	const shape = `{ ${renderedEntries
		.map(
			(entry) =>
				`${JSON.stringify(entry.name)}${entry.required ? "" : "?"}: ${entry.type}${entry.required ? "" : " | undefined"};`,
		)
		.join(" ")} }`;

	if (schema.additionalProperties === false) return shape;
	if (
		schema.additionalProperties === true ||
		schema.additionalProperties === undefined
	) {
		return entries.length === 0
			? "Record<string, unknown>"
			: `${shape} & Record<string, unknown>`;
	}

	const additional = renderRecursiveSchemaType(
		schema.additionalProperties as Schema,
		options,
	);
	const indexValue = [
		additional,
		...renderedEntries.flatMap((entry) =>
			entry.required ? [entry.type] : [entry.type, "undefined"],
		),
	];
	return entries.length === 0
		? `{ [key: string]: ${additional}; }`
		: `${shape} & { [key: string]: ${[...new Set(indexValue)].join(" | ")}; }`;
}

function baseType(
	schema: SchemaRecord,
	options: RecursiveSchemaTypeOptions,
): string {
	if (Array.isArray(schema.type)) {
		return [
			...new Set(
				schema.type.map((type) =>
					type === "null"
						? "null"
						: baseType({ ...schema, type }, options),
				),
			),
		].join(" | ");
	}

	switch (schema.type) {
		case "boolean":
			return "boolean";
		case "string":
			return "string";
		case "number":
		case "integer":
			return "number";
		case "array":
			return `Array<${schema.items === undefined ? "unknown" : renderRecursiveSchemaType(schema.items as Schema, options)}>`;
		case "object":
			return objectType(schema, options);
		case "null":
			return "null";
		default:
			if (
				schema.properties !== undefined ||
				schema.additionalProperties !== undefined
			) {
				return objectType(schema, options);
			}
			return "unknown";
	}
}

const validationKeywords = new Set([
	"$ref",
	"enum",
	"const",
	"oneOf",
	"anyOf",
	"allOf",
	"type",
	"format",
	"minLength",
	"maxLength",
	"pattern",
	"minimum",
	"maximum",
	"exclusiveMinimum",
	"exclusiveMaximum",
	"multipleOf",
	"items",
	"minItems",
	"maxItems",
	"properties",
	"required",
	"additionalProperties",
]);

function siblingType(
	schema: SchemaRecord,
	primaryKeyword: "$ref" | "enum" | "const" | "oneOf" | "anyOf" | "allOf",
	options: RecursiveSchemaTypeOptions,
): string | undefined {
	const sibling = { ...schema };
	delete sibling[primaryKeyword];
	delete sibling.nullable;
	if (
		primaryKeyword === "allOf" &&
		sibling.additionalProperties !== undefined &&
		sibling.properties === undefined
	) {
		delete sibling.additionalProperties;
	}
	const keys = Object.keys(sibling).filter((key) => validationKeywords.has(key));
	if (keys.length === 0) return undefined;

	if (
		sibling.type === undefined &&
		keys.some((key) => ["format", "minLength", "maxLength", "pattern"].includes(key))
	) {
		sibling.type = "string";
	}
	if (
		sibling.type === undefined &&
		keys.some((key) =>
			[
				"minimum",
				"maximum",
				"exclusiveMinimum",
				"exclusiveMaximum",
				"multipleOf",
			].includes(key),
		)
	) {
		sibling.type = "number";
	}
	if (
		sibling.type === undefined &&
		keys.some((key) => ["items", "minItems", "maxItems"].includes(key))
	) {
		sibling.type = "array";
	}
	if (
		sibling.type === undefined &&
		keys.some((key) =>
			["properties", "required", "additionalProperties"].includes(key),
		)
	) {
		sibling.type = "object";
	}

	const rendered = renderRecursiveSchemaType(sibling as Schema, options);
	return rendered === "unknown" ? undefined : rendered;
}

function renderRecursiveSchemaType(
	schema: Schema,
	options: RecursiveSchemaTypeOptions,
): string {
	if (schema === true || schema === undefined) return "unknown";
	if (schema === false) return "never";
	if (!isRecord(schema)) return "unknown";
	const record: SchemaRecord = schema;

	let result: string;
	let primaryKeyword:
		| "$ref"
		| "enum"
		| "const"
		| "oneOf"
		| "anyOf"
		| "allOf"
		| undefined;
	if (typeof record.$ref === "string") {
		primaryKeyword = "$ref";
		result = refType(record.$ref, options);
	} else if (Array.isArray(record.enum)) {
		primaryKeyword = "enum";
		const literals = record.enum.map(literalType);
		result =
			literals.length === 0 || literals.includes("never")
				? "never"
				: literals.join(" | ");
	} else if ("const" in record) {
		primaryKeyword = "const";
		result = literalType(record.const);
	} else if (Array.isArray(record.oneOf)) {
		primaryKeyword = "oneOf";
		result = unionType(record.oneOf, options);
	} else if (Array.isArray(record.anyOf)) {
		primaryKeyword = "anyOf";
		result = unionType(record.anyOf, options);
	} else if (Array.isArray(record.allOf)) {
		primaryKeyword = "allOf";
		result = intersectionType(record.allOf, options);
	} else {
		result = baseType(record, options);
	}

	if (primaryKeyword) {
		const sibling = siblingType(record, primaryKeyword, options);
		if (sibling) result = `${parenthesize(result)} & ${parenthesize(sibling)}`;
	}
	if (record.nullable === true && result !== "null") {
		result = `${parenthesize(result)} | null`;
	}
	return result;
}

export function recursiveSchemaTypeTemplate(
	schema: Schema,
	options: RecursiveSchemaTypeOptions,
): string {
	if (options.fallbackToUnknown) return "unknown";
	return renderRecursiveSchemaType(schema, options);
}
