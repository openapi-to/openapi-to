//@ts-nocheck
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PluginManager } from "@openapi-to/core";
import { checkFolderHasFiles } from "@openapi-to/core/utils";
// 导入TsType插件
import { definePlugin as defineTsTypePlugin } from "@openapi-to/plugin-ts-type";
import {
	ModuleKind,
	ModuleResolutionKind,
	Project,
	ScriptTarget,
	type SourceFile,
} from "ts-morph";
import { flattenDiagnosticMessageText } from "typescript";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import mockOpenAPI from "../mock/petstore.json";
import { definePlugin } from "./plugin";

// 获取当前文件的目录
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_OUTPUT_DIR = path.resolve(__dirname, "../test-output");
const MSW_CONSUMER_ROOT = path.resolve(__dirname, "../../../e2e/module");

function assertGeneratedSourcesCompile(sourceFiles: readonly SourceFile[]): void {
	const outputDir = fs.mkdtempSync(
		path.join(MSW_CONSUMER_ROOT, ".tmp-msw-generated-"),
	);
	try {
		const generatedProject = new Project({
			compilerOptions: {
				allowImportingTsExtensions: true,
				module: ModuleKind.NodeNext,
				moduleResolution: ModuleResolutionKind.NodeNext,
				noEmit: true,
				skipLibCheck: true,
				strict: true,
				target: ScriptTarget.ES2022,
			},
		});
		for (const sourceFile of sourceFiles) {
			const relativePath = path.relative(
				TEST_OUTPUT_DIR,
				sourceFile.getFilePath(),
			);
			const targetPath = path.join(outputDir, relativePath);
			fs.mkdirSync(path.dirname(targetPath), { recursive: true });
			fs.writeFileSync(targetPath, sourceFile.getFullText());
			generatedProject.createSourceFile(
				targetPath,
				sourceFile.getFullText(),
				{ overwrite: true },
			);
		}
		expect(
			generatedProject
				.getPreEmitDiagnostics()
				.map((diagnostic) =>
					flattenDiagnosticMessageText(
						diagnostic.compilerObject.messageText,
						"\n",
					),
				),
		).toEqual([]);
	} finally {
		fs.rmSync(outputDir, { recursive: true, force: true });
	}
}

describe("MSW Plugin Integration", () => {
	it.each(["3.0.3", "3.1.0", "3.2.0"])(
		"generates exact classic method handlers and fails closed for TRACE in OAS %s",
		async (openapi) => {
			const methods = [
				"get",
				"post",
				"put",
				"patch",
				"delete",
				"head",
				"options",
			] as const;
			const paths = Object.fromEntries([
				...methods.map((method) => [
					`/${method}`,
					{
						[method]: {
							operationId: `${method}Method`,
							tags: ["methods"],
							responses: { "200": { description: "ok" } },
						},
					},
				]),
				[
					"/trace",
					{
						trace: {
							operationId: "traceMethod",
							tags: ["methods"],
							responses: { "200": { description: "ok" } },
						},
					},
				],
			]);
			const document = {
				openapi,
				info: { title: "Classic methods", version: "1" },
				paths,
			};
			const createManager = () =>
				new PluginManager(
					{
						name: "msw-classic-methods",
						root: "",
						plugins: [defineTsTypePlugin(), definePlugin()],
						input: { path: "" },
						output: { dir: TEST_OUTPUT_DIR },
					},
					document,
				);
			const result = await createManager().execute();
			const repeated = await createManager().execute();
			const fingerprint = (sourceFiles: readonly SourceFile[]) =>
				sourceFiles
					.map((sourceFile) => [
						sourceFile.getFilePath(),
						sourceFile.getFullText(),
					] as const)
					.sort(([left], [right]) =>
						left < right ? -1 : left > right ? 1 : 0,
					);
			expect(fingerprint(repeated.sourceFiles)).toEqual(
				fingerprint(result.sourceFiles),
			);
			const handlers = result.sourceFiles.filter((sourceFile) =>
				sourceFile.getFilePath().endsWith(".handler.ts"),
			);
			expect(handlers).toHaveLength(methods.length);

			for (const method of methods) {
				const handler = handlers.find((sourceFile) =>
					sourceFile.getFilePath().endsWith(`/${method}-method.handler.ts`),
				);
				expect(handler, `${method} handler`).toBeDefined();
				expect(handler?.getFullText()).toContain(`http.${method}(`);
				if (method !== "get")
					expect(handler?.getFullText()).not.toContain("http.get(");
			}
			assertGeneratedSourcesCompile(result.sourceFiles);
			expect(
				handlers.some((sourceFile) =>
					sourceFile.getFilePath().endsWith("/trace-method.handler.ts"),
				),
			).toBe(false);
			expect(result.diagnostics).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						code: "MSW_UNSUPPORTED_METHOD",
						severity: "error",
						message: expect.stringContaining("TRACE"),
						location: expect.objectContaining({
							path: ["paths", "/trace", "trace"],
						}),
					}),
				]),
			);
		},
	);

	it("fails closed for QUERY and exact custom methods", async () => {
		const document = {
			openapi: "3.2.0", info: { title: "QUERY", version: "1" },
			paths: { "/search": {
				query: { operationId: "querySearch", tags: ["search"], responses: { "200": { description: "ok" } } },
				additionalOperations: { FoO: { operationId: "fooSearch", tags: ["search"], responses: { "204": { description: "ok" } } } },
			} },
		};
		const result = await new PluginManager({ name: "msw-32", root: "", plugins: [defineTsTypePlugin(), definePlugin({ responseDefaultType: "faker" })], input: { path: "" }, output: { dir: TEST_OUTPUT_DIR } }, document).execute();
		expect(result.diagnostics).toEqual(expect.arrayContaining([
			expect.objectContaining({ code: "MSW_UNSUPPORTED_METHOD", severity: "error", message: expect.stringContaining("QUERY"), location: expect.objectContaining({ path: ["paths", "/search", "query"] }) }),
			expect.objectContaining({ code: "MSW_UNSUPPORTED_METHOD", severity: "error", message: expect.stringContaining("FoO"), location: expect.objectContaining({ path: ["paths", "/search", "additionalOperations", "FoO"] }) }),
		]));
		expect(result.sourceFiles.some((sourceFile) => sourceFile.getFilePath().endsWith(".handler.ts"))).toBe(false);
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

	it("应该生成MSW handler文件", async () => {
		const pluginManager = new PluginManager(
			{
				name: "msw",
				root: "",
				plugins: [
					defineTsTypePlugin(),
					definePlugin({
						responseDefaultType: "faker",
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

		// 检查pet目录
		const petDir = path.join(TEST_OUTPUT_DIR, "pet");
		expect(fs.existsSync(petDir)).toBe(true);

		// 查找pet目录下的所有handler文件
		const handlerFiles = fs
			.readdirSync(petDir)
			.filter((file) => file.endsWith(".handler.ts"));
		expect(handlerFiles.length).toBeGreaterThan(0);

		// 选取第一个handler文件进行内容检查
		const petHandlerPath = path.join(petDir, handlerFiles[0]);
		const fileContent = fs.readFileSync(petHandlerPath, "utf-8");

		// 验证MSW handler文件内容
		expect(fileContent).toContain("Handler");
		expect(fileContent).toContain("export const enabled = false");
		expect(fileContent).toContain("export default");

		expect(fileContent).toMatchSnapshot();
	});

	it("应该生成不同responseDefaultType配置的handler文件", async () => {
		const pluginManager = new PluginManager(
			{
				name: "msw",
				root: "",
				plugins: [
					defineTsTypePlugin(),
					definePlugin({
						responseDefaultType: "",
						importWithExtension: false,
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

		// 检查user目录是否存在（如果mock数据中有user相关的API）
		const userDir = path.join(TEST_OUTPUT_DIR, "user");
		if (fs.existsSync(userDir)) {
			const handlerFiles = fs
				.readdirSync(userDir)
				.filter((file) => file.endsWith(".handler.ts"));

			if (handlerFiles.length > 0) {
				const userHandlerPath = path.join(userDir, handlerFiles[0]);
				const fileContent = fs.readFileSync(userHandlerPath, "utf-8");

				expect(fileContent).toContain("Handler");
				expect(fileContent).toContain("export const enabled = false");
			}
		}
	});
});
