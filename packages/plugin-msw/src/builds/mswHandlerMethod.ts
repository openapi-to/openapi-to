import type { OperationWrapper } from "@openapi-to/core";

type MswHandlerMethod =
	| "get"
	| "head"
	| "post"
	| "put"
	| "patch"
	| "delete"
	| "options";

export function getMswHandlerMethod(
	operation: OperationWrapper,
): MswHandlerMethod | undefined {
	if (operation.sourceKind !== "fixed") return undefined;

	switch (operation.method) {
		case "get":
			return "get";
		case "head":
			return "head";
		case "post":
			return "post";
		case "put":
			return "put";
		case "patch":
			return "patch";
		case "delete":
			return "delete";
		case "options":
			return "options";
		default:
			return undefined;
	}
}
