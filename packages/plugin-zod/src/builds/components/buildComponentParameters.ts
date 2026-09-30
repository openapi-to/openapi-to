import {
	type ComponentsParameterValue,
	resolveParameterSchema,
	type Schema,
} from "@openapi-to/core";
import { jsDocTemplateFromSchema } from "@/templates/jsDocTemplateFromSchema.ts";
import { createVariable } from "@/templates/operationResponseTemplate.ts";
import {
	type SchemaRenderOptions,
	schemaTemplate,
} from "@/templates/schemaTemplate.ts";
import {
	getComponentExportName,
	getComponentRefExportName,
} from "@/utils/componentNaming.ts";

export function buildComponentParameters(
	parameter: ComponentsParameterValue,
	parameterName: string,
	options: SchemaRenderOptions = {},
) {
	const parameterTypeName = getComponentExportName("parameters", parameterName);

	if (parameter && "$ref" in parameter && parameter.$ref) {
		const typeName = getComponentRefExportName(parameter.$ref);
		return createVariable(parameterTypeName, typeName, []);
	}

	if (parameter && !("$ref" in parameter)) {
		const schema: Schema =
			Object.keys(parameter.content ?? {}).length > 1
				? false
				: (resolveParameterSchema(parameter) ?? {
						type: "string",
					});
		const typeString = schemaTemplate(schema, parameterTypeName, "", options);

		return createVariable(
			parameterTypeName,
			typeString,
			jsDocTemplateFromSchema(
				parameter.description || "",
				schema,
				parameterName,
			),
		);
	}
	return undefined;
}
