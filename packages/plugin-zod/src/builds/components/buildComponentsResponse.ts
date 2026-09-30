import {
	type ComponentsResponsesValue,
	describeResponse,
} from "@openapi-to/core";
import { componentResponseTemplate } from "@/templates/componentResponseTemplate.ts";
import { createVariable } from "@/templates/operationResponseTemplate.ts";
import type { SchemaRenderOptions } from "@/templates/schemaTemplate.ts";
import {
	getComponentExportName,
	getComponentRefExportName,
} from "@/utils/componentNaming.ts";

export function buildComponentsResponse(
	response: ComponentsResponsesValue,
	responseName: string,
	options: SchemaRenderOptions = {},
) {
	const exportName = getComponentExportName("responses", responseName);
	if (response && "$ref" in response && response.$ref) {
		const typeName = getComponentRefExportName(response.$ref);
		return createVariable(exportName, typeName, []);
	}
	if (
		response &&
		!("$ref" in response) &&
		Object.keys(response.content ?? {}).length > 1
	) {
		return componentResponseTemplate({ schema: false }, exportName, options);
	}

	const descriptor = describeResponse(response);
	if (descriptor.kind === "no-content")
		return createVariable(exportName, "z.undefined()", []);
	if (descriptor.kind === "unknown-media")
		return createVariable(exportName, "z.unknown()", []);
	return componentResponseTemplate(
		{ schema: descriptor.schema },
		exportName,
		options,
	);
}
