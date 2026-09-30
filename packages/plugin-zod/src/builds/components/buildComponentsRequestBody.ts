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
): VariableStatementStructure | undefined {
	const name = getComponentExportName("requestBodies", requestName);
	// 处理引用类型
	if (requestBody && "$ref" in requestBody && requestBody.$ref) {
		return createVariable(
			name,
			getComponentRefExportName(requestBody.$ref),
			[],
		);
	}

	if ("content" in requestBody) {
		if (Object.keys(requestBody.content ?? {}).length > 1) {
			return createVariable(name, "z.never()", []);
		}
		const body = head(values(requestBody.content));
		if (!body) {
			return undefined;
		}

		return requestBodyTemplate(name, body, options);
	}
}
