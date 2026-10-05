import type { OperationWrapper } from "@openapi-to/core";
import { describe, expect, it } from "vitest";
import { buildMethodBody } from "./buildMethodBody.ts";
import { buildMethodParameters } from "./buildMethodParameters.ts";

describe("Vue grouped input", () => {
	it.each(["get", "post"])(
		"resolves reactive values before %s request and keeps config/key contract",
		(method) => {
			const operation = {
				method,
				path: "/items/{id}",
				accessor: {
					operationName: "getItem",
					hasPathParameters: true,
					hasQueryParameters: true,
					hasRequestBody: method === "post",
					pathParameters: [{ name: "id" }],
					queryParameters: [{ name: "q" }],
					operationTSType: { responseError: "Error" },
					operationRequest: { requestName: "getItemService" },
				},
			} as unknown as OperationWrapper;
			const text = buildMethodBody(operation, {
				placeholderData: { value: "keepPreviousData", pathInclude: [] },
				responseErrorTypeImportDeclaration: { namedImports: ["AxiosError"] },
			} as never);
			expect(text).toContain("path: { id: toValue(id) }");
			expect(text).toContain("query: toValue(params)");
			if (method === "post") {
				expect(text).toContain("body: toValue(data)");
				expect(text).toContain("}, requestConfig)");
			}
			else {
				expect(text).toContain("{ ...requestConfig, signal }");
				expect(text).not.toContain("requestConfig.signal = signal");
				expect(text).toContain("getItemQueryKey(toValue(id),params)");
			}
			expect(text).not.toMatch(/input\.(headers|cookies)/);
		},
	);

	it("requires typed reactive headers in options and keeps them out of query keys", () => {
		const operation = {
			method: "get",
			path: "/items",
			accessor: {
				operationName: "getItem",
				hasPathParameters: false,
				hasQueryParameters: true,
				hasRequestBody: false,
				hasHeaderParameters: true,
				isHeaderParametersOptional: false,
				isQueryParametersOptional: true,
				pathParameters: [],
				queryParameters: [{ name: "q" }],
				operationTSType: {
					queryParams: "GetItemQueryParams",
					headerParams: "GetItemHeaderParams",
					responseError: "Error",
				},
				operationRequest: { requestName: "getItemService" },
			},
		} as unknown as OperationWrapper;
		const pluginConfig = {
			requestConfigTypeImportDeclaration: { namedImports: ["RequestConfig"] },
			responseErrorTypeImportDeclaration: { namedImports: ["AxiosError"] },
		} as never;
		const parameters = buildMethodParameters(operation, pluginConfig);
		const options = parameters.at(-1);
		const body = buildMethodBody(operation, {
			placeholderData: { value: "keepPreviousData", pathInclude: [] },
			responseErrorTypeImportDeclaration: { namedImports: ["AxiosError"] },
		} as never);
		expect(String(options?.name)).toBe("options");
		expect(String(options?.type)).toContain(
			"headers: MaybeRefOrGetter<GetItemHeaderParams>",
		);
		expect(body).toContain("headers: toValue(headers)");
		expect(body).toContain("getItemQueryKey(params)");
		expect(body).not.toContain("getItemQueryKey(params,headers)");
	});

	it("forwards typed reactive cookies with normal and mutation requests, outside query keys", () => {
		const operation = {
			method: "get",
			path: "/items",
			accessor: {
				operationName: "getItem",
				hasPathParameters: false,
				hasQueryParameters: true,
				hasRequestBody: false,
				hasCookieParameters: true,
				isCookieParametersOptional: false,
				isQueryParametersOptional: true,
				pathParameters: [],
				queryParameters: [{ name: "q" }],
				operationTSType: {
					queryParams: "GetItemQueryParams",
					cookieParams: "GetItemCookieParams",
					responseError: "Error",
				},
				operationRequest: { requestName: "getItemService" },
			},
		} as unknown as OperationWrapper;
		const parameters = buildMethodParameters(operation, {
			requestConfigTypeImportDeclaration: { namedImports: ["RequestConfig"] },
			responseErrorTypeImportDeclaration: { namedImports: ["AxiosError"] },
		} as never);
		const options = parameters.at(-1);
		const body = buildMethodBody(operation, {
			placeholderData: { value: "keepPreviousData", pathInclude: [] },
			responseErrorTypeImportDeclaration: { namedImports: ["AxiosError"] },
		} as never);
		expect(String(options?.name)).toBe("options");
		expect(String(options?.type)).toContain(
			"cookies: MaybeRefOrGetter<GetItemCookieParams>",
		);
		expect(body).toContain("cookies: toValue(cookies)");
		expect(body).not.toContain("getItemQueryKey(params,cookies)");

		Object.assign(operation, { method: "post" });
		Object.assign(operation.accessor, { hasRequestBody: true });
		const mutation = buildMethodBody(operation, {
			responseErrorTypeImportDeclaration: { namedImports: ["AxiosError"] },
		} as never);
		expect(mutation).toContain("cookies: toValue(cookies)");
	});
});
