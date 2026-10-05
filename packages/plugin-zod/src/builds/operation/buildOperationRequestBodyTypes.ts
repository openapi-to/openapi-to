import {
	getOperationRequestBodyMediaTypeObject,
	inspectOpenAPI32MediaContent,
	operationSourcePath,
	getOperationRequestBodyMediaTypes,
	type OperationWrapper,
	type ReferenceObject,
} from "@openapi-to/core";
import type { OpenAPIV3, OpenAPIV3_1 } from "openapi-types";
import type { VariableStatementStructure } from "ts-morph";
import { createVariable } from "@/templates/operationResponseTemplate.ts";
import { getRequestBodyTypeName } from "@/templates/operationTypeNameTemplate.ts";
import { requestBodyTemplate } from "@/templates/requestBodyTemplate.ts";
import type { SchemaRenderOptions } from "@/templates/schemaTemplate.ts";

type MediaTypeObject = OpenAPIV3.MediaTypeObject | OpenAPIV3_1.MediaTypeObject;

export function buildOperationRequestBodyTypes(
	operation: OperationWrapper,
	options: SchemaRenderOptions = {},
): VariableStatementStructure | undefined {
	const bodyDataName = getRequestBodyTypeName(operation.accessor.operationName);
	const requestBody = operation.accessor.operation.schema.requestBody;
	const entries = String(operation.accessor.operation.api?.openapi).startsWith("3.2.")
		? inspectOpenAPI32MediaContent(operation.accessor.operation.api, requestBody, [...operationSourcePath(operation), "requestBody"])
		: [];
	if (entries.some((entry) => !entry.semantics || entry.semantics.hasItemSchema)) return createVariable(bodyDataName, "z.never()", []);
	if (requestBody && "$ref" in requestBody && requestBody.$ref) {
		return requestBodyTemplate(bodyDataName, requestBody, options);
	}
	if (
		getOperationRequestBodyMediaTypes(operation.accessor.operation).length > 1
	) {
		return createVariable(bodyDataName, "z.never()", []);
	}

	// 获取请求体 schema
	const bodySchema = getRequestBodySchema(operation);

	if (!bodySchema) {
		return undefined;
	}
	const selected = entries.find((entry) => entry.mediaType === getOperationRequestBodyMediaTypes(operation.accessor.operation)[0]);
	return requestBodyTemplate(bodyDataName, selected?.mediaObject as MediaTypeObject | undefined ?? bodySchema, options);
}

// ---------------- 辅助函数 ----------------

function getRequestBodySchema(
	operation: OperationWrapper,
): MediaTypeObject | ReferenceObject | null {
	const requestBody = operation.accessor.operation.schema.requestBody;
	// Preserve a referenced Request Body Object before selecting its media type.
	if (requestBody && "$ref" in requestBody && requestBody.$ref) {
		return requestBody;
	}
	return (
		getOperationRequestBodyMediaTypeObject(operation.accessor.operation) || null
	);
}
