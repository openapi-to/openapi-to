import {
	inspectOpenAPI32OperationMedia,
	type OpenAPI32MediaEntry,
	type OperationWrapper,
	operationSourcePath,
} from "@openapi-to/core";

export function unsupportedMedia(
	operation: OperationWrapper,
): OpenAPI32MediaEntry | undefined {
	return inspectOpenAPI32OperationMedia(
		operation.accessor.operation,
		operationSourcePath(operation),
	).find((entry) => {
		const semantics = entry.semantics;
		if (!semantics) return true;
		return (
			semantics.family === "sequential-json" ||
			semantics.family === "sse" ||
			semantics.hasItemSchema ||
			semantics.encodingMode === "positional" ||
			entry.schemaReferenceUnresolved ||
			entry.nestedMultipart ||
			(semantics.family === "multipart" &&
				(semantics.normalizedMediaType !== "multipart/form-data" ||
					entry.positionalArray ||
					entry.formDataArrayProperty))
		);
	});
}
