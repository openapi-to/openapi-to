import { inspectOpenAPI32MediaContent, type MediaTypeObject } from "@openapi-to/core";
import type { ReferenceObject, RequestBodyObject } from "@openapi-to/core";
import { head, values } from "lodash-es";
import type { VariableStatementStructure } from "ts-morph";
import { createVariable } from "@/templates/operationResponseTemplate.ts";
import { requestBodyTemplate } from "@/templates/requestBodyTemplate.ts";
import type { SchemaRenderOptions } from "@/templates/schemaTemplate.ts";
import {
	getComponentExportName,
	getComponentRefExportName,
} from "@/utils/componentNaming.ts";

export function buildComponentsRequestBody(
	requestName: string,
	requestBody: ReferenceObject | RequestBodyObject,
	options: SchemaRenderOptions = {},
	document?: unknown,
	path?: Array<string | number>,
): VariableStatementStructure | undefined {
	const name = getComponentExportName("requestBodies", requestName);
	const referencedEntries = document && path ? inspectOpenAPI32MediaContent(document, requestBody, path) : [];
	if (referencedEntries.some((entry) => !entry.semantics || entry.semantics.hasItemSchema)) return createVariable(name, "z.never()", []);
	// 处理引用类型
	if (requestBody && "$ref" in requestBody && requestBody.$ref) {
		return createVariable(
			name,
			getComponentRefExportName(requestBody.$ref),
			[],
		);
	}

	if ("content" in requestBody) {
		const entries = document && path ? inspectOpenAPI32MediaContent(document, requestBody, path) : [];
		if (entries.some((entry) => !entry.semantics || entry.semantics.hasItemSchema)) return createVariable(name, "z.never()", []);
		if (Object.keys(requestBody.content ?? {}).length > 1) {
			return createVariable(name, "z.never()", []);
		}
		const body = head(values(requestBody.content));
		if (!body) {
			return undefined;
		}

		const selected = entries.find((entry) => entry.mediaType === Object.keys(requestBody.content)[0]);
		return requestBodyTemplate(name, selected?.mediaObject as MediaTypeObject | undefined ?? body, options);
	}
}
