import { isQueryOperation, type OperationWrapper } from "@openapi-to/core";
import {
	formatterModuleSpecifier,
	getRelativePath,
} from "@openapi-to/core/utils";
import { compact, isEmpty, union } from "lodash-es";
import { type ImportDeclarationStructure, StructureKind } from "ts-morph";
import type { PluginConfig } from "../types.ts";
import { requestContract } from "./requestContract.ts";


export function buildImports(
	filePath: string,
	operation: OperationWrapper,
	pluginConfig?: PluginConfig,
): Array<ImportDeclarationStructure> {
	const request = operation.accessor.operationRequest;
	const operationType = operation.accessor.operationTSType;
	const requestTypes = requestContract(operation, pluginConfig ?? {}, filePath);
	const isFetch = request?.transport === "fetch";

	const isMutation = !isQueryOperation(operation);
	const isInfinite = operation.accessor.queryParameters.some(
		(param) => param.name === pluginConfig?.infinite?.pageNumParam,
	);
	const swr: ImportDeclarationStructure = {
		kind: StructureKind.ImportDeclaration,
		defaultImport: "useSWR",
		moduleSpecifier: "swr",
	};
	const swrTypes: ImportDeclarationStructure = {
		kind: StructureKind.ImportDeclaration,
		namedImports: ["Fetcher", "SWRConfiguration"],
		isTypeOnly: true,
		moduleSpecifier: "swr",
	};

	const useSWRInfinite: ImportDeclarationStructure = {
		kind: StructureKind.ImportDeclaration,
		defaultImport: "useSWRInfinite",
		moduleSpecifier: "swr/infinite",
	};

	const useSWRMutation: ImportDeclarationStructure = {
		kind: StructureKind.ImportDeclaration,
		defaultImport: "useSWRMutation",
		moduleSpecifier: "swr/mutation",
	};

	const SWRMutationConfiguration: ImportDeclarationStructure = {
		kind: StructureKind.ImportDeclaration,
		namedImports: ["SWRMutationConfiguration"],
		isTypeOnly: true,
		moduleSpecifier: "swr/mutation",
	};
	// response 和error 的moduleSpecifier是否相等
	const errorConfigModule = requestTypes.moduleSpecifier ?? (pluginConfig?.responseErrorTypeImportDeclaration?.moduleSpecifier || "");
	const errorConfigNames = requestTypes.moduleSpecifier ? [requestTypes.responseErrorType] : pluginConfig?.responseErrorTypeImportDeclaration?.namedImports;
	const moduleSpecifierIsEqual =
		!isFetch && !isEmpty(
			pluginConfig?.responseConfigTypeImportDeclaration?.moduleSpecifier,
		) &&
		!isEmpty(
			errorConfigModule,
		) &&
		pluginConfig?.responseConfigTypeImportDeclaration?.moduleSpecifier ===
			errorConfigModule;

	const hasResponseConfig = !isFetch && !isEmpty(
		pluginConfig?.responseConfigTypeImportDeclaration?.namedImports,
	);
	const responseConfig = {
		kind: StructureKind.ImportDeclaration,
		namedImports:
			pluginConfig?.responseConfigTypeImportDeclaration?.namedImports,
		isTypeOnly: true,
		moduleSpecifier:
			pluginConfig?.responseConfigTypeImportDeclaration?.moduleSpecifier || "",
	};
	const hasErrorConfig = !isEmpty(
		errorConfigNames,
	);
	const errorConfig = {
		kind: StructureKind.ImportDeclaration,
		namedImports: errorConfigNames,
		isTypeOnly: true,
		moduleSpecifier: errorConfigModule,
	};

	return [
		...(isMutation
			? [useSWRMutation, SWRMutationConfiguration]
			: isInfinite
				? [useSWRInfinite]
				: [swr, swrTypes]),

		...[
			{
				kind: StructureKind.ImportDeclaration,
				isTypeOnly: true,
				namedImports: [
					operationType?.pathParams,
					operationType?.queryParams,
					operationType?.querystring,
					operationType?.body,
					operationType?.headerParams,
					operationType?.cookieParams,
					...(operation.accessor.operationRequest?.transport === "fetch" ? [] : [operationType?.responseSuccess]),
					operationType?.responseError,
				].filter(Boolean),
				moduleSpecifier: formatterModuleSpecifier(
					getRelativePath(filePath, operationType?.filePath || ""),
					pluginConfig?.importWithExtension,
				),
			},
			{
				kind: StructureKind.ImportDeclaration,
				namedImports: [request?.requestName || ""],
				moduleSpecifier: formatterModuleSpecifier(
					getRelativePath(filePath, request?.filePath || ""),
					pluginConfig?.importWithExtension,
				),
			},
		],
		...(moduleSpecifierIsEqual
			? [
					{
						kind: StructureKind.ImportDeclaration,
						namedImports: compact(
							union(
								pluginConfig?.responseConfigTypeImportDeclaration?.namedImports,
								pluginConfig?.responseErrorTypeImportDeclaration?.namedImports,
							),
						),
						isTypeOnly: true,
						moduleSpecifier:
							pluginConfig?.responseErrorTypeImportDeclaration
								?.moduleSpecifier || "",
					},
				]
			: [
					hasResponseConfig ? responseConfig : undefined,
					hasErrorConfig ? errorConfig : undefined,
				]),
	] as Array<ImportDeclarationStructure>;
}
