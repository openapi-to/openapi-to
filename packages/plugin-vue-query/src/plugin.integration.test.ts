//@ts-nocheck
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PluginManager } from "@openapi-to/core";
import { checkFolderHasFiles } from "@openapi-to/core/utils";
import { definePlugin as defineTsRequestPlugin } from "@openapi-to/plugin-ts-request";
// 导入TsType插件
import { definePlugin as defineTsTypePlugin } from "@openapi-to/plugin-ts-type";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import ts from "typescript";
import mockOpenAPI from "../mock/petstore.json";
import { definePlugin } from "./plugin";

const GeneratedFunction = ((...parameters: string[]) => {
	const body = parameters.pop() ?? "";
	return new globalThis.Function(...parameters, ts.transpile(body));
}) as unknown as FunctionConstructor;

// 获取当前文件的目录
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_OUTPUT_DIR = path.resolve(__dirname, "../test-output");

describe("Ts Request Plugin Integration", () => {
	it("keys and forwards querystring for GET, QUERY and mutation", async () => {
		const parameter = { name: "whole", in: "querystring", required: true, content: { "application/json": { schema: { type: "object" } } } };
		const responses = { "200": { description: "ok" } };
		const document = { openapi: "3.2.1", info: { title: "querystring", version: "1" }, paths: {
			"/get": { get: { operationId: "getWhole", tags: ["whole"], parameters: [parameter], responses } },
			"/query": { query: { operationId: "queryWhole", tags: ["whole"], parameters: [parameter], requestBody: { content: { "application/json": { schema: { type: "object" } } } }, responses } },
			"/post": { post: { operationId: "postWhole", tags: ["whole"], parameters: [parameter], responses } },
			"/collision/{querystring}": { get: { operationId: "collisionWhole", tags: ["whole"], parameters: [parameter, { name: "querystring", in: "path", required: true, schema: { type: "string" } }], responses } },
		} };
		const result = await new PluginManager({ name: "vue-query-querystring", root: "", plugins: [defineTsTypePlugin(), defineTsRequestPlugin(), definePlugin()], input: { path: "" }, output: { dir: TEST_OUTPUT_DIR } }, document).execute();
		const source = (name: string) => result.sourceFiles.find((file) => file.getFullText().includes(name))?.getFullText() ?? "";
		const get = source("useGetWholeQuery");
		const query = source("useQueryWholeQuery");
		const mutation = source("usePostWhole");
		const getFile = result.sourceFiles.find((file) => file.getFullText().includes("useGetWholeQuery"));
		const initializer = getFile?.getVariableDeclaration("getWholeQueryKey")?.getInitializer()?.getText();
		if (!initializer) throw new Error("Missing GET key");
		const key = GeneratedFunction("toValue", `return (${initializer});`)((value: unknown) => typeof value === "object" && value !== null && "value" in value ? value.value : value);
		expect(key({ value: { a: 1 } })).not.toEqual(key({ value: { a: 2 } }));
		expect(get).toContain("querystring: toValue(querystring)");
		expect(get).toMatch(/import type \{[^}]*GetWholeQuerystring[^}]*\}/s);
		expect(query).toContain("body: toValue(data)");
		expect(query).toContain("querystring: toValue(querystring)");
		expect(mutation).toContain("querystring: toValue(querystring)");
		expect(mutation).toContain("querystring: MaybeRefOrGetter<PostWholeQuerystring>");
		expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "VUE_QUERY_BINDING_COLLISION", location: expect.objectContaining({ path: ["paths", "/collision/{querystring}", "get"] }) }));
		expect(ts.transpileModule(mutation, { reportDiagnostics: true }).diagnostics).toEqual([]);
	});
	it("supports optional-body QUERY and rejects custom methods", async () => {
		const document = {
			openapi: "3.2.0", info: { title: "QUERY", version: "1" },
			paths: { "/search": {
				query: { operationId: "querySearch", tags: ["search"], parameters: [{ name: "limit", in: "query", required: true, schema: { type: "integer" } }, { name: "x-trace", in: "header", schema: { type: "string" } }, { name: "session", in: "cookie", schema: { type: "string" } }], requestBody: { content: { "application/json": { schema: { type: "object" } } } }, responses: { "200": { description: "ok" } } },
				additionalOperations: { FoO: { operationId: "fooSearch", tags: ["search"], responses: { "204": { description: "ok" } } } },
			}, "/conflict/{data}": {
				query: { operationId: "queryConflict", tags: ["search"], parameters: [{ name: "data", in: "path", required: true, schema: { type: "string" } }], requestBody: { content: { "application/json": { schema: { type: "object" } } } }, responses: { "200": { description: "ok" } } },
			}, "/local-conflict/{requestConfig}": {
				query: { operationId: "queryLocalConflict", tags: ["search"], parameters: [{ name: "requestConfig", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "ok" } } },
			} },
		};
		const result = await new PluginManager({ name: "vue-query-32", root: "", plugins: [defineTsTypePlugin(), defineTsRequestPlugin(), definePlugin()], input: { path: "" }, output: { dir: TEST_OUTPUT_DIR } }, document).execute();
		const text = result.sourceFiles.map((sourceFile) => sourceFile.getFullText()).find((value) => value.includes("useQuerySearchQuery"));
		expect(text).toContain("method: 'QUERY'");
		expect(text).toContain("body: toValue(data)");
		expect(text).toContain("query: toValue(params)");
		expect(text).toMatch(/params: MaybeRefOrGetter<QuerySearchQueryParams>,\s*data\?: MaybeRefOrGetter<QuerySearchMutationRequest>/);
		expect(ts.transpileModule(text ?? "", { reportDiagnostics: true }).diagnostics).toEqual([]);
		const querySource = result.sourceFiles.find((sourceFile) => sourceFile.getFullText().includes("useQuerySearchQuery"));
		const initializer = querySource?.getVariableDeclaration("querySearchQueryKey")?.getInitializer()?.getText();
		if (!initializer) throw new Error("Missing generated Vue QUERY key initializer");
		const queryKey = GeneratedFunction("toValue", `return (${initializer});`)((value: unknown) => value);
		const bodyA = queryKey({ limit: 10 }, { term: "A" });
		const bodyB = queryKey({ limit: 10 }, { term: "B" });
		expect(bodyA).not.toEqual(bodyB);
		expect(Object.keys(bodyA[0])).toEqual(["url", "method", "body", "query"]);
		expect(bodyA).toEqual([{ url: "/search", method: "QUERY", body: { term: "A" }, query: { limit: 10 } }]);
		expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "VUE_QUERY_UNSUPPORTED_METHOD", message: expect.stringContaining("FoO"), location: expect.objectContaining({ path: ["paths", "/search", "additionalOperations", "FoO"] }) }));
		expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "VUE_QUERY_BINDING_COLLISION", message: expect.stringContaining("data"), location: expect.objectContaining({ path: ["paths", "/conflict/{data}", "query"] }) }));
		expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "VUE_QUERY_BINDING_COLLISION", message: expect.stringContaining("requestConfig"), location: expect.objectContaining({ path: ["paths", "/local-conflict/{requestConfig}", "query"] }) }));
		expect(result.sourceFiles.some((sourceFile) => sourceFile.getFullText().includes("useQueryConflictQuery"))).toBe(false);
		expect(result.sourceFiles.some((sourceFile) => sourceFile.getFullText().includes("useQueryLocalConflictQuery"))).toBe(false);
	});

	beforeEach(() => {
		// 清理并重新创建测试输出目录
		if (fs.existsSync(TEST_OUTPUT_DIR)) {
			fs.rmSync(TEST_OUTPUT_DIR, { recursive: true, force: true });
		}
		fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });

		console.log(`测试目录已准备: ${TEST_OUTPUT_DIR}`);
	});

	afterEach(() => {
		// 确保测试目录存在
		if (!fs.existsSync(TEST_OUTPUT_DIR)) {
			fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
		}
	});

	it("应该生成默认的服务类文件", async () => {
		const pluginManager = new PluginManager(
			{
				name: "request",
				root: "",
				plugins: [
					defineTsTypePlugin(),
					defineTsRequestPlugin(),
					definePlugin({
						placeholderData: {
							value: "keepPreviousData",
							pathInclude: ["pet", /\/pet\/\w+/],
						},
						dataReturnType: "tags",
					}),
				],
				input: {
					path: "",
				},
				output: {
					dir: TEST_OUTPUT_DIR,
				},
			},
			// @ts-expect-error
			mockOpenAPI,
		);

		await pluginManager.run();

		// 检查文件是否生成
		const hasFiles = checkFolderHasFiles(TEST_OUTPUT_DIR);
		expect(hasFiles).toBe(true);

		// 修正为正确的文件路径 - 检查pet目录
		const petDir = path.join(TEST_OUTPUT_DIR, "pet");
		expect(fs.existsSync(petDir)).toBe(true);

		// 查找pet目录下的所有service文件
		const queryFiles = fs
			.readdirSync(petDir)
			.filter((file) => file.endsWith(".service.ts"));
		expect(queryFiles.length).toBeGreaterThan(0);

		// 选取第一个服务文件进行内容检查
		const petServicePath = path.join(petDir, "use-add-pet.mutation.ts");
		const fileContent = fs.readFileSync(petServicePath, "utf-8");

		expect(fileContent).toContain("useAddPet");

		expect(fileContent).toMatchSnapshot();
	});
});
