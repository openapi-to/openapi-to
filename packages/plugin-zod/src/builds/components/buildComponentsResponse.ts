import {
	type ComponentsResponsesValue,
	describeResponse,
	inspectOpenAPI32MediaContent,
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
	document?: unknown,
	path?: Array<string | number>,
) {
	const exportName = getComponentExportName("responses", responseName);
	const referencedEntries = document && path ? inspectOpenAPI32MediaContent(document, response, path) : [];
	if (referencedEntries.some((entry) => !entry.semantics || entry.semantics.hasItemSchema)) return createVariable(exportName, "z.never()", []);
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

	const entries = document && path ? inspectOpenAPI32MediaContent(document, response, path) : [];
	if (entries.some((entry) => !entry.semantics || entry.semantics.hasItemSchema)) return createVariable(exportName, "z.never()", []);
	const descriptor = describeResponse(response);
	if (descriptor.kind === "no-content")
		return createVariable(exportName, "z.undefined()", []);
	if (descriptor.kind === "unknown-media" && !entries.some((entry) => entry.mediaType === descriptor.contentType && entry.mediaObject?.schema !== undefined))
		return createVariable(exportName, "z.unknown()", []);
	return componentResponseTemplate(
		{ schema: entries.find((entry) => entry.mediaType === descriptor.contentType)?.mediaObject?.schema as typeof descriptor.schema ?? descriptor.schema },
		exportName,
		options,
	);
}
