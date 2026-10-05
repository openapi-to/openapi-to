import type { RequiredDeep } from "type-fest";

export enum RequestClientEnum {
	AXIOS = "axios",
	COMMON = "common",
	FETCH = "fetch",
}

export type RequestClient = "axios" | "common" | "fetch";

export type RequiredPluginConfig = RequiredDeep<
	Omit<PluginConfig, "parser" | "cookieTransport">
> & {
	parser?: "zod";
	cookieTransport?: "header";
};

export type PluginConfig = {
	requestImportDeclaration?: {
		moduleSpecifier: string;
	};
	requestConfigTypeImportDeclaration?: {
		namedImports: Array<string>;
		moduleSpecifier: string;
	};
	requestClient?: RequestClient;
	parser?: "zod";
	cookieTransport?: "header";
	/**
	 * 是否在 import 路径中添加扩展名（如 .ts）
	 */
	importWithExtension?: boolean;
	/**
	 * ReturnType that will be used when calling the client.Use dataReturnType only in get method
	 */
	dataReturnType?: string;
};

export type OperationTypeOfTag = {
	namedImports: string[];
	moduleSpecifier: string;
};
