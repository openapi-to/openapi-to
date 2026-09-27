import { describe, expect, it, vi } from "vitest";
import { RequestClientEnum } from "../types";
import { buildMethodBody } from "./buildMethodBody";

// 模拟URLPath工具类
vi.mock("@openapi-to/core/utils", () => ({
	URLPath: class URLPath {
		requestPath: string;
		constructor(path: string) {
			this.requestPath = `'${path}'`;
		}
	},
}));

describe("buildMethodBody", () => {
	it("应该为Axios客户端生成正确的GET请求方法体", () => {
		const operation = {
			path: "/pet/{petId}",
			method: "get",
			tagName: "pets",
			accessor: {
				operation: {
					path: "/pet/{petId}",
					getContentType: () => "application/json",
				},
				hasQueryParameters: true,
				hasRequestBody: false,
				isDownLoad: false,
				hasQueryParametersArray: false,
				isJsonContainsDefaultCases: true,
				dataReturnType: [],
				operationTSType: () => ({
					responseSuccess: "Pet",
				}),
			},
		};

		const pluginConfig = {
			requestClient: RequestClientEnum.AXIOS,
			requestConfigTypeImportDeclaration: {
				namedImports: ["AxiosRequestConfig"],
				moduleSpecifier: "axios",
			},
			requestImportDeclaration: {
				moduleSpecifier: "axios",
			},
			importWithExtension: true,
			dataReturnType: "",
		};

		const result = buildMethodBody(operation as never, pluginConfig);

		expect(result).toContain(`method:'GET'`);
		expect(result).toContain(`url:'/pet/{petId}'`);
		expect(result).toContain("params");
		expect(result).toContain("return res.data");
	});

	it("应该为Common客户端生成含请求体的POST方法体", () => {
		const operation = {
			path: "/pet",
			method: "post",
			tagName: "pets",
			accessor: {
				operation: {
					path: "/pet",
					getContentType: () => "application/json",
				},
				hasQueryParameters: false,
				hasRequestBody: true,
				isDownLoad: false,
				hasQueryParametersArray: false,
				isJsonContainsDefaultCases: false,
				operationTSType: {
					responseSuccess: "ApiResponse",
					body: "Pet",
				},
			},
		};

		const pluginConfig = {
			requestClient: RequestClientEnum.COMMON,
			requestImportDeclaration: {
				moduleSpecifier: "@/utils/request",
			},
			requestConfigTypeImportDeclaration: {
				namedImports: [],
				moduleSpecifier: "",
			},
			importWithExtension: true,
			dataReturnType: "",
		};

		const result = buildMethodBody(operation as never, pluginConfig);

		expect(result).toContain(`method:'POST'`);
		expect(result).toContain(`url:'/pet'`);
		expect(result).toContain("data");
		expect(result).toContain("Content-Type");
		expect(result).toContain("await request<ApiResponse>");
	});

	it("应该为文件下载请求生成正确方法体", () => {
		const operation = {
			path: "/download",
			method: "get",
			tagName: "downloads",
			accessor: {
				operation: {
					path: "/download",
					getContentType: () => "application/octet-stream",
				},
				hasQueryParameters: false,
				hasRequestBody: false,
				isDownLoad: true,
				hasQueryParametersArray: false,
				isJsonContainsDefaultCases: false,
				dataReturnType: [],
				operationTSType: () => ({
					responseSuccess: "Blob",
				}),
			},
		};

		const pluginConfig = {
			requestClient: RequestClientEnum.AXIOS,
			requestImportDeclaration: {
				moduleSpecifier: "axios",
			},
			requestConfigTypeImportDeclaration: {
				namedImports: [],
				moduleSpecifier: "",
			},
			importWithExtension: true,
			dataReturnType: "",
		};

		const result = buildMethodBody(operation as never, pluginConfig);

		expect(result).toContain(`responseType:'blob'`);
	});

	it("uses real request/response parsers for nullable bodies and 204 responses", () => {
		const operation = {
			path: "/nullable",
			method: "post",
			tagName: "nullable",
			accessor: {
				operation: {
					path: "/nullable",
					getContentType: () => "application/json",
				},
				hasQueryParameters: false,
				hasRequestBody: true,
				isDownLoad: false,
				hasQueryParametersArray: false,
				isJsonContainsDefaultCases: true,
				operationTSType: {
					responseSuccess: "NullableMutationResponse",
					body: "NullableMutationRequest",
				},
				operationZodSchema: {
					body: "nullableMutationRequestSchema",
					responseSuccess: "nullableMutationResponseSchema",
				},
			},
		};
		const result = buildMethodBody(operation as never, {
			requestClient: RequestClientEnum.COMMON,
			parser: "zod",
			requestImportDeclaration: { moduleSpecifier: "@/utils/request" },
			requestConfigTypeImportDeclaration: {
				namedImports: [],
				moduleSpecifier: "",
			},
			importWithExtension: true,
			dataReturnType: "",
		});

		expect(result).toContain("nullableMutationRequestSchema.parse(data)");
		expect(result).toContain("nullableMutationResponseSchema.parse(res.data)");
		expect(result).not.toContain("undefined.parse(");
	});

	it("serializes bounded Header parameters and validates with Zod before Common dispatch", () => {
		const operation = {
			path: "/items",
			method: "get",
			accessor: {
				operation: { path: "/items", getContentType: () => "application/json" },
				hasHeaderParameters: true,
				hasQueryParameters: false,
				hasRequestBody: false,
				isHeaderParametersOptional: false,
				isJsonContainsDefaultCases: true,
				headerParameterSerialization: [
					{
						name: "X-Trace",
						required: true,
						strategy: "schema-simple",
						style: "simple",
						explode: false,
						schemaPresent: true,
					},
					{
						name: "X-Tags",
						required: false,
						strategy: "schema-simple",
						style: "simple",
						explode: false,
						schemaPresent: true,
					},
				],
				operationTSType: { responseSuccess: "Result" },
				operationZodSchema: {
					headerParams: "itemHeaderParamsSchema",
					responseSuccess: "itemResponseSchema",
				},
			},
		} as never;
		const result = buildMethodBody(operation, {
			requestClient: RequestClientEnum.COMMON,
			parser: "zod",
			requestImportDeclaration: { moduleSpecifier: "@/utils/request" },
			requestConfigTypeImportDeclaration: {
				namedImports: ["RequestConfig"],
				moduleSpecifier: "@/utils/request",
			},
			importWithExtension: true,
			dataReturnType: "",
		} as never);
		expect(
			result.indexOf("itemHeaderParamsSchema.parse(input.headers)"),
		).toBeLessThan(result.indexOf("await request<Result>"));
		expect(result).toContain("item.style !== 'simple'");
		expect(result).toContain("value.map(primitive).join(',')");
		expect(result).toContain(
			"mergeCommonHeaders(generatedHeaders, serializedHeaders, configHeaders)",
		);
		expect(result).toContain("Unsupported requestConfig.headers container");
		expect(result).not.toContain("String(configHeaders)");
	});

	it("uses AxiosHeaders case-insensitive precedence and keeps the merged bag after requestConfig spread", () => {
		const operation = {
			path: "/items",
			method: "post",
			accessor: {
				operation: { path: "/items", getContentType: () => "application/json" },
				hasHeaderParameters: true,
				hasQueryParameters: false,
				hasRequestBody: false,
				isHeaderParametersOptional: true,
				isJsonContainsDefaultCases: false,
				headerParameterSerialization: [
					{
						name: "X-Request-Id",
						required: false,
						strategy: "schema-simple",
						style: "simple",
						explode: false,
						schemaPresent: true,
					},
				],
				operationTSType: { responseSuccess: "Result" },
			},
		} as never;
		const result = buildMethodBody(operation, {
			requestClient: RequestClientEnum.AXIOS,
			requestImportDeclaration: { moduleSpecifier: "@/utils/request" },
			requestConfigTypeImportDeclaration: {
				namedImports: ["AxiosRequestConfig"],
				moduleSpecifier: "axios",
			},
			importWithExtension: true,
			dataReturnType: "",
		} as never);
		expect(result).toContain(
			"AxiosHeaders.concat(generatedHeaders, serializedHeaders, requestConfig?.headers)",
		);
		expect(result.indexOf("...requestConfig")).toBeLessThan(
			result.indexOf("headers: finalHeaders"),
		);
		expect(result).toContain("'Content-Type':'application/json'");
	});

	it("fails closed for Parameter Object content instead of stringifying it", () => {
		const operation = {
			path: "/items",
			method: "get",
			accessor: {
				operation: { path: "/items", getContentType: () => "application/json" },
				hasHeaderParameters: true,
				hasQueryParameters: false,
				hasRequestBody: false,
				isHeaderParametersOptional: true,
				isJsonContainsDefaultCases: true,
				headerParameterSerialization: [
					{
						name: "X-Content",
						required: false,
						strategy: "content",
						style: "simple",
						explode: false,
						schemaPresent: false,
						contentMediaType: "text/plain",
					},
				],
				operationTSType: { responseSuccess: "Result" },
			},
		} as never;
		const result = buildMethodBody(operation, {
			requestClient: RequestClientEnum.COMMON,
			requestImportDeclaration: { moduleSpecifier: "@/utils/request" },
			requestConfigTypeImportDeclaration: {
				namedImports: [],
				moduleSpecifier: "",
			},
			importWithExtension: true,
			dataReturnType: "",
		} as never);
		expect(result).toContain(
			"OpenAPI Header Parameter content serialization is unsupported.",
		);
		expect(result).not.toContain("JSON.stringify(value)");
	});
});
