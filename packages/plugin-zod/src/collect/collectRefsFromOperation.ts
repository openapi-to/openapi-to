import { inspectOpenAPI32QuerystringMedia, operationSourcePath, type OperationWrapper } from "@openapi-to/core";
import {
	collectRefsFromOperationParameter,
	collectRefsFromOperationRequestBody,
	collectRefsFromOperationResponse,
} from "@/collect/collectRefsFromDocument.ts";
import { collectRefsFromSchema, type CollectRefsFromSchemaOptions } from "@/collect/collectRefsFromSchemas.ts";

export function collectRefsFromOperation(
	operation: OperationWrapper,
	options: CollectRefsFromSchemaOptions = {},
): string[] {
	// 收集响应中的引用

	const oasOperation = operation.accessor.operation;
	const querystringEntries = String(oasOperation.api?.openapi).startsWith("3.2.")
		? inspectOpenAPI32QuerystringMedia(oasOperation, operationSourcePath(operation))
		: [];
	const querystringRefs = querystringEntries.every((entry) => entry.semantics && !entry.semantics.hasItemSchema)
		? querystringEntries.flatMap((entry) => entry.mediaObject?.schema === undefined ? [] : collectRefsFromSchema(entry.mediaObject.schema as Parameters<typeof collectRefsFromSchema>[0], options))
		: [];

	return [
		...new Set([
			...collectRefsFromOperationParameter([
				...operation.accessor.pathParameters,
				...operation.accessor.queryParameters,
				...operation.accessor.headerParameters,
				...operation.accessor.cookieParameters,
			], options),
			...querystringRefs,
			...collectRefsFromOperationRequestBody(oasOperation, options),
			...collectRefsFromOperationResponse(oasOperation, options),
		]),
	];
}
