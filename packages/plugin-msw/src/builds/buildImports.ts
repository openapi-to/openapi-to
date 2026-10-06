import type { OperationFakerResponse, OperationWrapper } from "@openapi-to/core";
import {
	formatterModuleSpecifier,
	getRelativePath,
} from "@openapi-to/core/utils";

import { type ImportDeclarationStructure, StructureKind } from "ts-morph";
import type { PluginConfig } from "../types.ts";

export function buildImports(
	operation: OperationWrapper,
	pluginConfig: PluginConfig,
	filePath: string,
	fakerResponse?: OperationFakerResponse,
): Array<ImportDeclarationStructure> {
	const msw: ImportDeclarationStructure = {
		kind: StructureKind.ImportDeclaration,
		namedImports: ["http", "HttpResponse"],
		moduleSpecifier: "msw",
	};

	const responseSuccess: ImportDeclarationStructure = {
		kind: StructureKind.ImportDeclaration,
		isTypeOnly: true,
		namedImports: [
			operation.accessor.operationTSType?.responseSuccess || "never",
		],
		moduleSpecifier: formatterModuleSpecifier(
			getRelativePath(
				filePath,
				operation.accessor.operationTSType?.filePath || "",
			),
			pluginConfig?.importWithExtension,
		),
	};

	const shouldIncludeFakerImport =
		pluginConfig.responseDefaultType === "faker" &&
		fakerResponse?.factoryName &&
		operation.accessor.operationFaker?.filePath;

	const fakerResponseSuccess: ImportDeclarationStructure | null = shouldIncludeFakerImport
		? {
				kind: StructureKind.ImportDeclaration,
				namedImports: [fakerResponse.factoryName],
				moduleSpecifier: formatterModuleSpecifier(
					getRelativePath(
						filePath,
						operation.accessor.operationFaker?.filePath ?? "",
					),
					pluginConfig?.importWithExtension,
				),
		  }
		: null;

	return [
		responseSuccess,
		msw,
		...(fakerResponseSuccess ? [fakerResponseSuccess] : []),
	] as Array<ImportDeclarationStructure>;
}
