//@ts-nocheck
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PluginManager } from "@openapi-to/core";
import { checkFolderHasFiles } from "@openapi-to/core/utils";
// 导入TsType插件
import { definePlugin as defineTsTypePlugin } from "@openapi-to/plugin-ts-type";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import mockOpenAPI from "../mock/petstore.json";
import { definePlugin } from "./plugin";

// 获取当前文件的目录
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_OUTPUT_DIR = path.resolve(__dirname, "../test-output");

describe("Ts Request Plugin Integration", () => {
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
					definePlugin({
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
		const serviceFiles = fs
			.readdirSync(petDir)
			.filter((file) => file.endsWith(".service.ts"));
		expect(serviceFiles.length).toBeGreaterThan(0);

		// 选取第一个服务文件进行内容检查
		const petServicePath = path.join(petDir, serviceFiles[0]);
		const fileContent = fs.readFileSync(petServicePath, "utf-8");

		expect(fileContent).toContain("Service");
		expect(fileContent).toMatch(/addPet|updatePet|findPetsByStatus/);

		expect(fileContent).toMatchSnapshot();
	});

	it("generates one Fetch runtime artifact without Axios or a caller request wrapper", async () => {
		const pluginManager = new PluginManager(
			{
				name: "request-fetch",
				root: "",
				plugins: [defineTsTypePlugin(), definePlugin({ requestClient: "fetch" })],
				input: { path: "" },
				output: { dir: TEST_OUTPUT_DIR },
			},
			// @ts-expect-error
			{
				openapi: "3.0.3",
				info: { title: "Fetch fixture", version: "1" },
				paths: {
					"/items/{id}": {
						get: {
							operationId: "getItem",
							tags: ["items"],
							parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
							responses: { "200": { description: "ok", content: { "application/json": { schema: { $ref: "#/components/schemas/Item" } } } } },
						},
					},
				},
				components: { schemas: { Item: { type: "object", properties: { id: { type: "string" } } } } },
			},
		);

		await pluginManager.run();
		const runtimePath = path.join(TEST_OUTPUT_DIR, "fetch-runtime.ts");
		expect(fs.existsSync(runtimePath)).toBe(true);
		const runtime = fs.readFileSync(runtimePath, "utf-8");
		expect(runtime).toContain("export type FetchRequestConfig");
		expect(runtime).toContain("export class FetchHttpError");
		expect(runtime).toContain("export type FetchRequestError");
		const services = fs.readdirSync(path.join(TEST_OUTPUT_DIR, "items"))
			.filter((file) => file.endsWith(".service.ts"));
		expect(services.length).toBeGreaterThan(0);
		const firstService = services[0];
		if (!firstService) throw new Error("Generated Fetch service file is missing.");
		const source = fs.readFileSync(path.join(TEST_OUTPUT_DIR, "items", firstService), "utf-8");
		expect(source).toContain("callFetch");
		expect(source).toContain("resolveFetchUrl");
		expect(source).not.toContain("from \"axios\"");
		expect(source).not.toContain("from \"@/utils/request\"");
	});

	it("fails closed for typed cookies, GET bodies, unsupported response media, and legacy config", async () => {
		const response = { "200": { description: "ok", content: { "application/json": { schema: { type: "string" } } } } };
		const document = {
			openapi: "3.0.3",
			info: { title: "Fetch validation", version: "1" },
			paths: {
				"/cookie": { get: { operationId: "getCookie", tags: ["items"], parameters: [{ name: "session", in: "cookie", schema: { type: "string" } }], responses: response } },
				"/body": { get: { operationId: "getBody", tags: ["items"], requestBody: { content: { "application/json": { schema: { type: "object" } } } }, responses: response } },
				"/xml": { get: { operationId: "getXml", tags: ["items"], responses: { "200": { description: "ok", content: { "application/xml": { schema: { type: "string" } } } } } } },
			},
		};
		const result = await new PluginManager({ name: "request-fetch-invalid", root: "", plugins: [defineTsTypePlugin(), definePlugin({ requestClient: "fetch" })], input: { path: "" }, output: { dir: TEST_OUTPUT_DIR } }, document).execute();
		expect(result.diagnostics.map(({ code }) => code)).toEqual(expect.arrayContaining([
			"TS_REQUEST_FETCH_COOKIE_UNSUPPORTED",
			"TS_REQUEST_FETCH_BODY_METHOD_UNSUPPORTED",
			"TS_REQUEST_FETCH_RESPONSE_MEDIA_UNSUPPORTED",
		]));
		expect(result.sourceFiles.filter((file) => file.getFilePath().endsWith(".service.ts"))).toHaveLength(0);

		const invalidConfig = await new PluginManager({ name: "request-fetch-config", root: "", plugins: [defineTsTypePlugin(), definePlugin({ requestClient: "fetch", dataReturnType: "data" })], input: { path: "" }, output: { dir: TEST_OUTPUT_DIR } }, { openapi: "3.0.3", info: { title: "Config", version: "1" }, paths: { "/items": { get: { operationId: "getItems", tags: ["items"], responses: response } } } }).execute();
		expect(invalidConfig.diagnostics).toContainEqual(expect.objectContaining({ code: "TS_REQUEST_FETCH_CONFIG_UNSUPPORTED", severity: "error" }));
		expect(invalidConfig.sourceFiles.filter((file) => file.getFilePath().endsWith(".service.ts"))).toHaveLength(0);
	});

	it("keeps OpenAPI 3.2 QUERY distinct from GET when it has a JSON body", async () => {
		const document = {
			openapi: "3.2.1",
			info: { title: "Fetch QUERY", version: "1" },
			paths: { "/search": { query: {
				operationId: "searchItems",
				tags: ["items"],
				requestBody: { content: { "application/json": { schema: { type: "object", properties: { term: { type: "string" } } } } } },
				responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "array", items: { type: "string" } } } } } },
			} } },
		};
		const result = await new PluginManager({ name: "fetch-query", root: "", plugins: [defineTsTypePlugin(), definePlugin({ requestClient: "fetch" })], input: { path: "" }, output: { dir: TEST_OUTPUT_DIR } }, document).execute();
		const service = result.sourceFiles.find((file) => file.getFilePath().endsWith("search-items.service.ts"))?.getFullText();
		expect(result.diagnostics.some(({ code, severity }) => code === "TS_REQUEST_FETCH_BODY_METHOD_UNSUPPORTED" && severity === "error")).toBe(false);
		expect(service).toContain('"QUERY"');
		expect(service).toContain("JSON.stringify(requestBody)");
	});

	it("types Fetch binary responses as Blob, including mixed success media", async () => {
		const document = {
			openapi: "3.0.3",
			info: { title: "Fetch binary response", version: "1" },
			paths: {
				"/download": { get: { operationId: "downloadFile", tags: ["files"], responses: {
					"200": { description: "file", content: { "application/pdf": { schema: { type: "string", format: "binary" } } } },
				} } },
				"/maybe-download": { get: { operationId: "maybeDownload", tags: ["files"], responses: {
					"200": { description: "file or metadata", content: {
						"application/json": { schema: { type: "object", properties: { name: { type: "string" } } } },
						"application/pdf": { schema: { type: "string", format: "binary" } },
					} },
				} } },
				"/mixed-text": { get: { operationId: "getMixedText", tags: ["files"], responses: {
					"200": { description: "json or text", content: {
						"application/json": { schema: { type: "object", properties: { name: { type: "string" } } } },
						"text/plain": { schema: { type: "string" } },
					} },
				} } },
			},
		};
		const result = await new PluginManager({ name: "fetch-binary-response", root: "", plugins: [defineTsTypePlugin(), definePlugin({ requestClient: "fetch" })], input: { path: "" }, output: { dir: TEST_OUTPUT_DIR } }, document).execute();
		const service = (name: string) => result.sourceFiles.find((sourceFile) => sourceFile.getFilePath().endsWith(`${name}.service.ts`))?.getFullText() ?? "";
		expect(service("download-file")).toContain("callFetch<Blob>");
		expect(service("maybe-download")).toMatch(/callFetch<[^>]*\| Blob>/);
		expect(service("get-mixed-text")).toMatch(/callFetch<[^>]*\| string>/);
	});

	it("retains response media through local Response Object references", async () => {
		const document = {
			openapi: "3.0.3",
			info: { title: "Fetch response reference", version: "1" },
			paths: {
				"/items": { get: { operationId: "getReferencedItem", tags: ["items"], responses: { "200": { $ref: "#/components/responses/ReferencedItem" } } } },
			},
			components: {
				responses: {
					ReferencedItem: { description: "item", content: { "application/json": { schema: { type: "object", properties: { id: { type: "string" } } } } } },
				},
			},
		};
		const result = await new PluginManager({ name: "fetch-response-reference", root: "", plugins: [defineTsTypePlugin(), definePlugin({ requestClient: "fetch" })], input: { path: "" }, output: { dir: TEST_OUTPUT_DIR } }, document).execute();
		const service = result.sourceFiles.find((sourceFile) => sourceFile.getFilePath().endsWith("get-referenced-item.service.ts"))?.getFullText() ?? "";
		expect(result.diagnostics.filter(({ severity }) => severity === "error")).toEqual([]);
		expect(service).toContain('{"200":["application/json"]}');
	});
});
