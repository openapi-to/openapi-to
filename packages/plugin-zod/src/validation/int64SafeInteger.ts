import type { OpenAPIRefSemanticContext } from "@openapi-to/core";
import { forEachSchemaNode } from "@/validation/unsupportedValidationKeywords.ts";

export type Int64SafeIntegerScanOptions = {
	refSemanticContext?: OpenAPIRefSemanticContext;
};

/** Detect int64 schema formats without inspecting annotation payloads. */
export function hasInt64SafeIntegerBoundary(
	schema: unknown,
	options: Int64SafeIntegerScanOptions = {},
): boolean {
	let found = false;
	forEachSchemaNode(
		schema,
		({ schema: node }) => {
			const type = node.type;
			const numeric =
				type === "integer" ||
				type === "number" ||
				(Array.isArray(type) &&
					type.some((member) => member === "integer" || member === "number"));
			if (node.format === "int64" && numeric) found = true;
		},
		{ refSemanticContext: options.refSemanticContext },
	);
	return found;
}

export const int64SafeIntegerDiagnosticMessage =
	"OpenAPI int64 exceeds JavaScript's exact safe-integer range. This generated schema keeps the current number representation and validates only Number.MIN_SAFE_INTEGER through Number.MAX_SAFE_INTEGER. Values outside that range, including precision-lost JSON numbers, are rejected.";
