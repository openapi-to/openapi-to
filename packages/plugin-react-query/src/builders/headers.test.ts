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

	it("forwards required Cookie input through query and mutation config without key or variable leakage", () => {
		const cookieOperation = operation();
		Object.assign(cookieOperation.accessor, {
			hasCookieParameters: true,
			isCookieParametersOptional: false,
			operationTSType: {
				...cookieOperation.accessor.operationTSType,
				cookieParams: "CreateItemCookieParams",
			},
		});
		const query = buildQuery(cookieOperation, config, "api");
		const mutation = buildMutation(cookieOperation, config, "api");
		expect(query).toContain("cookies: CreateItemCookieParams;");
		expect(query).toContain("cookies: options?.cookies");
		expect(query).not.toContain(
			"queryKey: createItemQueryKey(options?.cookies)",
		);
		expect(mutation).toContain("cookies: CreateItemCookieParams;");
		expect(mutation).toContain("cookies: options?.cookies");
		expect(mutation).not.toMatch(
			/export type CreateItemVariables = \{[^}]*cookies/s,
		);
	});
});
