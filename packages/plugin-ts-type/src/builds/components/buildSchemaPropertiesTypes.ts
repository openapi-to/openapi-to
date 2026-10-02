import { schemaTemplate } from "@/templates/schemaTemplate.ts";

import { isArray, isBoolean, isString } from "lodash-es";

import { jsDocTemplateFromSchema } from "@/templates/jsDocTemplateFromSchema.ts";
import type { SchemaObjectAndJSONSchema } from "@/types.ts";
import type {
	InlineEnumSourcePath,
	InlineEnumSymbolResolver,
} from "@/utils/inlineEnumNaming.ts";
import type { SchemaObject } from "oas/types";
import type { OptionalKind, PropertySignatureStructure } from "ts-morph";

type OptionalKindOfPropertySignatureStructure =
	OptionalKind<PropertySignatureStructure>;

export function buildSchemaPropertiesTypes(
	baseSchema: SchemaObject,
	schemaModelName: string,
	inlineEnumSymbols?: InlineEnumSymbolResolver,
	inlineEnumSourcePath?: InlineEnumSourcePath,
): OptionalKindOfPropertySignatureStructure[] | undefined {
	const properties = baseSchema.properties ?? {};
	const requiredList = resolveRequiredList(baseSchema.required);
	const undeclaredRequired = requiredList.filter(
		(name) => !Object.hasOwn(properties, name),
	);

	const typeStatements: OptionalKindOfPropertySignatureStructure[] =
		Object.entries(properties).map(([propertyName, schema]) => {
			const isRequired = requiredList.includes(propertyName);
			const typeString = schemaTemplate(
				schema,
				propertyName,
				schemaModelName,
				inlineEnumSymbols,
				inlineEnumSourcePath
					? [...inlineEnumSourcePath, "properties", propertyName]
					: undefined,
			);
			const propertyKey =
				renderPropertyKey(propertyName) + (isRequired ? "" : "?");

			return {
				name: propertyKey,
				type: typeString,
				docs: jsDocTemplateFromSchema(
					typeof schema === "object" &&
						schema !== null &&
						"description" in schema
						? schema.description
						: undefined,
					schema,
					propertyName,
				),
			};
		});

	const additionalType =
		baseSchema.additionalProperties === false
			? "never"
			: baseSchema.additionalProperties === undefined
				? "unknown"
				: resolveAdditionalPropertiesType(
						baseSchema,
						inlineEnumSymbols,
						inlineEnumSourcePath,
					);
	for (const name of undeclaredRequired) {
		typeStatements.push({
			name: renderPropertyKey(name),
			type: additionalType,
		});
	}

	if (
		(baseSchema.additionalProperties !== undefined ||
			undeclaredRequired.length > 0) &&
		baseSchema.additionalProperties !== false
	) {
		const additionalPropType = widenIndexSignatureForProperties(
			additionalType,
			typeStatements.slice(
				0,
				typeStatements.length - undeclaredRequired.length,
			),
		);
		typeStatements.push({
			name: "[key: string]",
			type: additionalPropType,
		});
	}

	return typeStatements.length ? typeStatements : undefined;
}

// -------------------- Helper Methods --------------------

function resolveRequiredList(required: unknown): string[] {
	if (isBoolean(required)) return [];
	if (isArray(required)) return [...new Set(required.filter(isString))];
	return [];
}

function renderPropertyKey(name: string): string {
	return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

function resolveAdditionalPropertiesType(
	schema: SchemaObjectAndJSONSchema,
	inlineEnumSymbols?: InlineEnumSymbolResolver,
	inlineEnumSourcePath?: InlineEnumSourcePath,
): string {
	if (
		!("additionalProperties" in schema) ||
		schema.additionalProperties === undefined ||
		schema.additionalProperties === false
	) {
		throw new Error("additionalProperties is undefined");
	}
	const additional = schema.additionalProperties;
	if (isBoolean(additional)) {
		return "unknown";
	}

	return schemaTemplate(
		additional,
		"",
		undefined,
		inlineEnumSymbols,
		inlineEnumSourcePath
			? [...inlineEnumSourcePath, "additionalProperties"]
			: undefined,
	);
}

function widenIndexSignatureForProperties(
	additionalType: string,
	properties: OptionalKindOfPropertySignatureStructure[],
): string {
	if (additionalType === "unknown" || properties.length === 0) {
		return additionalType;
	}

	const members = [additionalType];
	for (const property of properties) {
		if (typeof property.type === "string") members.push(property.type);
		if (typeof property.name === "string" && property.name.endsWith("?")) {
			members.push("undefined");
		}
	}
	return [...new Set(members)].join(" | ");
}
