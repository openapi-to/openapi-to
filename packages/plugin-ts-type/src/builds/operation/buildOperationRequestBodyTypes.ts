import {
	getOperationRequestBodyMediaType,
	inspectOpenAPI32MediaContent,
	type OperationWrapper,
	operationSourcePath,
	type ReferenceObject,
} from "@openapi-to/core";
import type { OpenAPIV3, OpenAPIV3_1 } from "openapi-types";
import type {
	InterfaceDeclarationStructure,
	TypeAliasDeclarationStructure,
} from "ts-morph";
import { getRequestBodyTypeName } from "@/templates/operationTypeNameTemplate.ts";
import { createTypeAlias } from "@/templates/operationResponseTemplate.ts";
import { requestBodyTemplate } from "@/templates/requestBodyTemplate.ts";
import type {
	InlineEnumSourcePath,
	InlineEnumSymbolResolver,
} from "@/utils/inlineEnumNaming.ts";

type MediaTypeObject = OpenAPIV3.MediaTypeObject | OpenAPIV3_1.MediaTypeObject;

export function buildOperationRequestBodyTypes(
	operation: OperationWrapper,
	inlineEnumSymbols?: InlineEnumSymbolResolver,
): InterfaceDeclarationStructure | TypeAliasDeclarationStructure | undefined {
	const bodyDataName = getRequestBodyTypeName(operation.accessor.operationName);

	// 获取请求体 schema
	const selected = getOperationRequestBodyMediaType(operation.accessor.operation);
	const entries = String(operation.accessor.operation.api?.openapi).startsWith("3.2.")
		? inspectOpenAPI32MediaContent(operation.accessor.operation.api, operation.accessor.operation.schema.requestBody, [...operationSourcePath(operation), "requestBody"])
		: [];
	if (entries.some((entry) => !entry.semantics || entry.semantics.hasItemSchema)) return createTypeAlias(bodyDataName, "never");
	const mediaEntry = entries.find((entry) => entry.mediaType === (selected ? selected[0] : undefined));
	const bodySchema = getRequestBodySchema(operation);

	if (!bodySchema) {
		return undefined;
	}

	return requestBodyTemplate(
		bodyDataName,
		mediaEntry?.mediaObject as MediaTypeObject | undefined ?? bodySchema.body,
		inlineEnumSymbols,
		bodySchema.sourcePath,
	);
}

// ---------------- 辅助函数 ----------------

function getRequestBodySchema(operation: OperationWrapper): {
	body: MediaTypeObject | ReferenceObject;
	sourcePath: InlineEnumSourcePath;
} | null {
	const sourcePath = operationSourcePath(operation);
	const requestBody = operation.accessor.operation.schema.requestBody;
	// Preserve a referenced Request Body Object before selecting its media type.
	if (requestBody && "$ref" in requestBody && requestBody.$ref) {
		return {
			body: requestBody,
			sourcePath: [...sourcePath, "requestBody"],
		};
	}

	const selectedMediaType = getOperationRequestBodyMediaType(
		operation.accessor.operation,
	);
	return selectedMediaType
		? {
				body: selectedMediaType[1],
				sourcePath: [
					...sourcePath,
					"requestBody",
					"content",
					selectedMediaType[0],
					"schema",
				],
			}
		: null;
}
