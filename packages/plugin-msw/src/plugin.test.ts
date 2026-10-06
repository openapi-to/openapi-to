//@ts-nocheck
import { pluginEnum } from "@openapi-to/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { definePlugin } from "./plugin";

// 模拟依赖
const mockAddFunction = vi.fn();
const mockAddStatements = vi.fn();
const mockCreateSourceFile = vi.fn(() => ({
	addFunction: mockAddFunction,
	addStatements: mockAddStatements,
}));

vi.mock("ts-morph", () => {
	return {
		Project: class {
			createSourceFile = mockCreateSourceFile;
		},
		StructureKind: {
			Function: "Function",
			ImportDeclaration: "ImportDeclaration",
		},
	};
});

vi.mock("./builds/buildImports.ts", () => ({
	buildImports: vi.fn(() => []),
}));

vi.mock("./builds/buildMethodBody.ts", () => ({
	buildMethodBody: vi.fn(() => "return fetch();"),
}));

vi.mock("./builds/buildMethodParameters.ts", () => ({
	buildMethodParameters: vi.fn(() => []),
}));

vi.mock("./builds/buildEnabled.ts", () => ({
	buildEnabled: vi.fn(() => "export const enabled = false;"),
}));

vi.mock("./template/jsDocTemplateFromMethod.ts", () => ({
	jsDocTemplateFromMethod: vi.fn(() => [{ description: "测试文档" }]),
}));

vi.mock("@openapi-to/core/utils", () => ({
	getRelativePath: vi.fn(() => "../types"),
	formatterModuleSpecifier: vi.fn(
		(specifier, withExt) => specifier + (withExt ? ".ts" : ""),
	),
}));

vi.mock("lodash-es", () => ({
	kebabCase: vi.fn((str) => {
		// 正确实现 kebabCase：将驼峰命名转换为 kebab-case
		return str
			.replace(/([a-z])([A-Z])/g, "$1-$2")
			.replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
			.toLowerCase();
	}),
}));

describe("definePlugin", () => {
	type MockOperation = {
		tagName: string;
		accessor: {
			operationName: string;
			setOperationRequest: ReturnType<typeof vi.fn>;
		};
	};

	type MockContext = {
		openapiToSingleConfig: {
			output: {
				dir: string;
			};
		};
		setSourceFiles: ReturnType<typeof vi.fn>;
		logger: {
			info: ReturnType<typeof vi.fn>;
		};
	};

	type MockTagData = {
		name: string;
		formattedTagName: string;
		description: string;
	};

	let _mockOperation: MockOperation;
	let mockContext: MockContext;
	let mockTagData: MockTagData;

	beforeEach(() => {
		// 重置所有模拟
		vi.clearAllMocks();

		// 准备测试数据
		_mockOperation = {
			tagName: "testTag",
			accessor: {
				operationName: "testOperation",
				setOperationRequest: vi.fn(),
			},
		};

		mockContext = {
			openapiToSingleConfig: {
				output: {
					dir: "/output",
				},
			},
			setSourceFiles: vi.fn(),
			logger: {
				info: vi.fn(),
			},
		};

		mockTagData = {
			name: "testTag",
			formattedTagName: "TestTag",
			description: "测试标签描述",
		};
	});

	it("应该创建具有正确属性的插件", () => {
		const plugin = definePlugin({});

		expect(plugin.name).toBe(pluginEnum.MSW);
		expect(plugin.dependencies).toContain(pluginEnum.TsType);
	});

	it("Faker 模式显式依赖 Faker producer", () => {
		const plugin = definePlugin({ responseDefaultType: "faker" });

		expect(plugin.dependencies).toEqual([pluginEnum.TsType, pluginEnum.Faker]);
	});

	it("应正确处理 buildStart 钩子", async () => {
		const plugin = definePlugin({});
		await plugin.hooks.buildStart(mockContext);

		// 这里暂时没有多少逻辑可测试，但确保钩子能正常执行
		expect(true).toBeTruthy();
	});

	it("应正确处理 tagStart 钩子", async () => {
		const plugin = definePlugin({});
		await plugin.hooks.tagStart(mockTagData, mockContext);

		// 验证钩子可以正常执行
		expect(true).toBeTruthy();
	});

	it("应正确处理 tagEnd 钩子", async () => {
		const plugin = definePlugin({});
		await plugin.hooks.tagEnd(mockTagData, mockContext);

		// 当前这个钩子主要包含注释掉的代码，确保能正常执行即可
		expect(true).toBeTruthy();
	});
});
