import { inspectOpenAPI32MediaContent, type MediaTypeObject } from "@openapi-to/core";
import type { ReferenceObject, RequestBodyObject } from "@openapi-to/core";
import { head, upperFirst } from "lodash-es";

import { createTypeAlias } from "@/templates/operationResponseTemplate.ts";
import { requestBodyTemplate } from "@/templates/requestBodyTemplate.ts";

import { getUpperFirstRefAlias } from "@/utils/getUpperFirstRefAlias.ts";
import type {
	InlineEnumSourcePath,
	InlineEnumSymbolResolver,
} from "@/utils/inlineEnumNaming.ts";
import type {
	InterfaceDeclarationStructure,
	TypeAliasDeclarationStructure,
} from "ts-morph";

export function buildComponentsRequestBody(
	requestName: string,
	requestBody: ReferenceObject | RequestBodyObject,
	inlineEnumSymbols?: InlineEnumSymbolResolver,
	inlineEnumSourcePath?: InlineEnumSourcePath,
	document?: unknown,
): InterfaceDeclarationStructure | TypeAliasDeclarationStructure | undefined {
	const name = `RequestBodies${upperFirst(requestName)}Model`;
	const referencedEntries = document && inlineEnumSourcePath ? inspectOpenAPI32MediaContent(document, requestBody, inlineEnumSourcePath) : [];
	if (referencedEntries.some((entry) => !entry.semantics || entry.semantics.hasItemSchema)) return createTypeAlias(name, "never", []);
	// 处理引用类型
	if (requestBody && "$ref" in requestBody && requestBody.$ref) {
		return createTypeAlias(name, getUpperFirstRefAlias(requestBody.$ref), []);
	}

	if ("content" in requestBody) {
		const content = head(Object.entries(requestBody.content));
		if (!content) {
			return undefined;
		}
		const [contentType, body] = content;
		const entries = document && inlineEnumSourcePath ? inspectOpenAPI32MediaContent(document, requestBody, inlineEnumSourcePath) : [];
		if (entries.some((entry) => !entry.semantics || entry.semantics.hasItemSchema)) return createTypeAlias(name, "never", []);
		const media = entries.find((entry) => entry.mediaType === contentType)?.mediaObject as MediaTypeObject | undefined ?? body;

		return inlineEnumSymbols
			? requestBodyTemplate(
					name,
					media,
					inlineEnumSymbols,
					inlineEnumSourcePath
						? [...inlineEnumSourcePath, "content", contentType, "schema"]
						: undefined,
				)
			: requestBodyTemplate(name, media);
	}
}
