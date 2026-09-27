import type { OperationWrapper } from "@openapi-to/core";
import { OpenAPIV3 } from "openapi-types";
import { describe, expect, it } from "vitest";
import { buildMethodBody } from "./buildMethodBody.ts";
import { buildMethodParameters } from "./buildMethodParameters.ts";

function queryOperation(): OperationWrapper {
	return {
		method: OpenAPIV3.HttpMethods.GET,
		accessor: {
			operationName: "getUser",
			hasQueryParameters: true,
			hasPathParameters: true,
			hasRequestBody: false,
			isQueryParametersOptional: true,
			pathParameters: [{ name: "userId" }],
			queryParameters: [{ name: "search" }],
			parameters: [{ name: "userId", in: "path" }],
			operationTSType: {
				pathParams: "GetUserPathParams",
				queryParams: "GetUserQueryParams",
				responseSuccess: "GetUserResponse",
				responseError: "GetUserResponseError",
			},
			operationRequest: { requestName: "getUser" },
		},
	} as unknown as OperationWrapper;
}

describe("REG-SWR-FETCHER-STRICT", () => {
	it("preserves mutation argument and shouldFetch while grouping body/path/query and forwarding config", () => {
		const operation = queryOperation();
		Object.assign(operation, { method: OpenAPIV3.HttpMethods.POST });
		Object.assign(operation.accessor, { hasRequestBody: true });
		const body = buildMethodBody(operation);
		expect(body).toContain("async (_url, { arg: data })");
		expect(body).toContain("shouldFetch ? mutationKey : null");
		expect(body).toContain(
			"getUser({ path: { userId }, query: params, body: data }, options?.requestConfig)",
		);
	});
	it("omits the unused fetcher key without changing key or request arguments", () => {
		const body = buildMethodBody(queryOperation());
		expect(body).toContain("fetcher: async () =>");
		expect(body).not.toMatch(/fetcher: async \(\s*_url/);
		expect(body).toContain(
			"return getUser({ path: { userId }, query: params }, options?.requestConfig);",
		);
		expect(body).toContain("const queryKey = getUserQueryKey(userId,params)");
	});

	it("uses the generated response error and key types instead of any", () => {
		const parameters = buildMethodParameters(queryOperation());
		const optionsType = String(parameters.at(-1)?.type);
		expect(optionsType).toContain(
			"SWRConfiguration<GetUserResponse, GetUserResponseError, Fetcher<GetUserResponse, GetUserQueryKey>>",
		);
		expect(optionsType).not.toMatch(/\bany\b/);
	});

	it("uses configured response wrappers consistently in options and the hook body", () => {
		const pluginConfig = {
			responseConfigTypeImportDeclaration: {
				namedImports: ["AxiosResponse"],
				moduleSpecifier: "axios",
			},
			responseErrorTypeImportDeclaration: {
				namedImports: ["AxiosError"],
				moduleSpecifier: "axios",
			},
		};
		const body = buildMethodBody(queryOperation(), pluginConfig);
		const optionsType = String(
			buildMethodParameters(queryOperation(), pluginConfig).at(-1)?.type,
		);
		expect(body).toContain("AxiosResponse<GetUserResponse>['data']");
		expect(body).toContain("AxiosError<GetUserResponseError>");
		expect(optionsType).toContain(
			"SWRConfiguration<AxiosResponse<GetUserResponse>['data'], AxiosError<GetUserResponseError>, Fetcher<AxiosResponse<GetUserResponse>['data'], GetUserQueryKey>>",
		);
	});

	it("keeps typed headers in options and forwards them outside keys and mutation args", () => {
		const operation = queryOperation();
		Object.assign(operation.accessor, {
			hasHeaderParameters: true,
			isHeaderParametersOptional: false,
			operationTSType: {
				...operation.accessor.operationTSType,
				headerParams: "GetUserHeaderParams",
			},
		});
		const options = buildMethodParameters(operation).at(-1);
		const body = buildMethodBody(operation);
		expect(String(options?.type)).toContain("headers: GetUserHeaderParams");
		expect(String(options?.name)).toBe("options");
		expect(body).toContain("query: params, headers }, options?.requestConfig");
		expect(body).not.toContain("getUserQueryKey(userId,params,headers)");

		Object.assign(operation, { method: OpenAPIV3.HttpMethods.POST });
		Object.assign(operation.accessor, { hasRequestBody: true });
		const mutation = buildMethodBody(operation);
		expect(mutation).toContain("async (_url, { arg: data })");
		expect(mutation).toContain("query: params, body: data, headers");
		expect(mutation).not.toContain("{ arg: data, headers }");
	});
});
