import { componentResponseTemplate } from "@/templates/componentResponseTemplate.ts";
import { createTypeAlias } from "@/templates/operationResponseTemplate.ts";
import { getUpperFirstRefAlias } from "@/utils/getUpperFirstRefAlias.ts";
import type {
	InlineEnumSourcePath,
	InlineEnumSymbolResolver,
} from "@/utils/inlineEnumNaming.ts";
import {
	type ComponentsResponsesValue,
	inspectOpenAPI32MediaContent,
	describeResponse,
} from "@openapi-to/core";

export function buildComponentsResponse(
	response: ComponentsResponsesValue,
	responseName: string,
	inlineEnumSymbols?: InlineEnumSymbolResolver,
	inlineEnumSourcePath?: InlineEnumSourcePath,
	document?: unknown,
) {
	const referencedEntries = document && inlineEnumSourcePath ? inspectOpenAPI32MediaContent(document, response, inlineEnumSourcePath) : [];
	if (referencedEntries.some((entry) => !entry.semantics || entry.semantics.hasItemSchema)) return createTypeAlias(responseName, "never", []);
	if (response && "$ref" in response && response.$ref) {
		const typeName = getUpperFirstRefAlias(response.$ref);
		return createTypeAlias(responseName, typeName, []);
	}

	const entries = document && inlineEnumSourcePath ? inspectOpenAPI32MediaContent(document, response, inlineEnumSourcePath) : [];
	if (entries.some((entry) => !entry.semantics || entry.semantics.hasItemSchema)) return createTypeAlias(responseName, "never", []);
	const descriptor = describeResponse(response);
	if (descriptor.kind === "no-content")
		return createTypeAlias(responseName, "undefined", []);
	if (descriptor.kind === "unknown-media" && !entries.some((entry) => entry.mediaType === descriptor.contentType && entry.mediaObject?.schema !== undefined))
		return createTypeAlias(responseName, "unknown", []);
	return componentResponseTemplate(
		{ schema: entries.find((entry) => entry.mediaType === descriptor.contentType)?.mediaObject?.schema as typeof descriptor.schema ?? descriptor.schema },
		responseName,
		inlineEnumSymbols,
		inlineEnumSourcePath && descriptor.contentType
			? [...inlineEnumSourcePath, "content", descriptor.contentType, "schema"]
			: inlineEnumSourcePath,
	);
}
