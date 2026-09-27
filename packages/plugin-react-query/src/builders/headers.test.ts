import type { OperationWrapper } from "@openapi-to/core";
import { describe, expect, it } from "vitest";
import { buildMutation } from "./buildMutation.ts";
import { buildQuery } from "./buildQuery.ts";

function operation(): OperationWrapper {
	return {
		method: "post",
		path: "/items",
		tagName: "items",
		accessor: {
			operationId: "createItem",
			operationName: "createItem",
			hasPathParameters: false,
			hasRequestBody: false,
			hasQueryParameters: false,
			hasHeaderParameters: true,
			isHeaderParametersOptional: false,
			isQueryParametersOptional: true,
			pathParameters: [],
			operationTSType: {
				headerParams: "CreateItemHeaderParams",
				responseSuccess: "CreateItemResponse",
				responseError: "CreateItemError",
			},
			operationRequest: { requestName: "createItemService" },
		},
	} as unknown as OperationWrapper;
}

const config = {
	requestConfigTypeImportDeclaration: { namedImports: ["AxiosRequestConfig"] },
	responseErrorTypeImportDeclaration: { namedImports: ["ApiError"] },
	hooks: false,
} as never;

describe("React Query typed Header options", () => {
	it("forwards required headers via query config without adding them to the query key", () => {
		const text = buildQuery(operation(), config, "api");
		expect(text).toContain("headers: CreateItemHeaderParams;");
		expect(text).toContain("options: CreateItemQueryConfig<TData>");
		expect(text).toContain("headers: options?.headers");
		expect(text).not.toContain(
			"queryKey: createItemQueryKey(options?.headers)",
		);
	});

	it("forwards required headers through config without adding them to mutation variables", () => {
		const text = buildMutation(operation(), config, "api");
		expect(text).toContain("headers: CreateItemHeaderParams;");
		expect(text).toContain("options: CreateItemMutationConfig");
		expect(text).toContain("headers: options?.headers");
		expect(text).not.toMatch(
			/export type CreateItemVariables = \{[^}]*headers/s,
		);
	});
});
