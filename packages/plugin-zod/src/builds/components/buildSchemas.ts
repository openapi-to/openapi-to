import type { ComponentsSchema } from "@openapi-to/core";
import {
	StructureKind,
	type InterfaceDeclarationStructure,
	type StatementStructures,
	type TypeAliasDeclarationStructure,
} from "ts-morph";
import { jsDocTemplateFromSchema } from "@/templates/jsDocTemplateFromSchema.ts";
import { createVariable } from "@/templates/operationResponseTemplate.ts";
import {
	type SchemaRenderOptions,
	schemaTemplate,
} from "@/templates/schemaTemplate.ts";
import { recursiveSchemaTypeTemplate } from "@/templates/recursiveSchemaTypeTemplate.ts";
import {
	getComponentExportName,
	getSchemaOutputTypeName,
} from "@/utils/componentNaming.ts";

export type SchemaDeclarationStructure =
	| InterfaceDeclarationStructure
	| TypeAliasDeclarationStructure;

export function buildSchemas(
	schemaName: string,
	schema: ComponentsSchema,
	options: SchemaRenderOptions = {},
	referenceName = schemaName,
): StatementStructures[] {
	const variableName = getComponentExportName("schemas", schemaName);
	const variable =
		typeof schema !== "object" || schema === null
			? createVariable(
					variableName,
					schemaTemplate(schema, schemaName, variableName, options),
					[],
				)
			: createVariable(
					variableName,
					schemaTemplate(schema, schemaName, variableName, options),
					"$ref" in schema
						? []
						: jsDocTemplateFromSchema(schema.description, schema),
				);

	if (options.lazyRefs?.has(`#/components/schemas/${referenceName}`)) {
		const declaration = variable.declarations[0];
		const outputTypeName = getSchemaOutputTypeName(schemaName);
		if (declaration) declaration.type = `z.ZodType<${outputTypeName}>`;
		return [
			{
				kind: StructureKind.TypeAlias,
				name: outputTypeName,
				isExported: true,
				type: recursiveSchemaTypeTemplate(schema, {
					lazyRefs: options.lazyRefs,
					fallbackToUnknown: options.unguardedRecursiveRefs?.has(
						`#/components/schemas/${referenceName}`,
					),
				}),
			},
			variable,
		];
	}
	return [variable];
}
