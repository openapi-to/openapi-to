import { isQueryOperation, type OperationWrapper } from "@openapi-to/core";
import {
	formatterModuleSpecifier,
	getRelativePath,
} from "@openapi-to/core/utils";
import { type ImportDeclarationStructure, StructureKind } from "ts-morph";
import type { RequiredPluginConfig } from "../types.ts";
import { hasPlaceholderData } from "../utils/hasPlaceholderData.ts";
import { requestContract } from "./requestContract.ts";


export function buildImports(
	filePath: string,
	operation: OperationWrapper,
	pluginConfig: RequiredPluginConfig,
): Array<ImportDeclarationStructure> {
	const request = operation.accessor.operationRequest;
	const operationType = operation.accessor.operationTSType;
	const requestTypes = requestContract(operation, pluginConfig, filePath);

	const isMutation = !isQueryOperation(operation);
	const isInfinite = operation.accessor.queryParameters.some(
		(param) => param.name === pluginConfig?.infinite?.pageNumParam,
	);
	const useQuery: ImportDeclarationStructure = {
		kind: StructureKind.ImportDeclaration,
		namedImports: [
			"useQuery",
			"queryOptions",
			hasPlaceholderData(pluginConfig.placeholderData, operation.path)
				? pluginConfig.placeholderData.value
				: undefined,
		].filter(Boolean),
		moduleSpecifier: "@tanstack/vue-query",
	};

	const vueOptions: ImportDeclarationStructure = {
		kind: StructureKind.ImportDeclaration,
		namedImports: ["toValue"],
		moduleSpecifier: "vue",
	};

	const maybeRefOrGetter: ImportDeclarationStructure = {
		kind: StructureKind.ImportDeclaration,
		namedImports: ["MaybeRefOrGetter"],
		isTypeOnly: true,
		moduleSpecifier: "vue",
	};
	const useQueryOptions: ImportDeclarationStructure = {
		kind: StructureKind.ImportDeclaration,
		namedImports: ["UseQueryOptions"],
		isTypeOnly: true,
		moduleSpecifier: "@tanstack/vue-query",
	};

	const useMutation: ImportDeclarationStructure = {
		kind: StructureKind.ImportDeclaration,
		namedImports: ["useMutation"],
		moduleSpecifier: "@tanstack/vue-query",
	};

	const requestConfigType: ImportDeclarationStructure = {
		kind: StructureKind.ImportDeclaration,
		namedImports: [requestTypes.requestConfigType],
		isTypeOnly: true,
		moduleSpecifier: requestTypes.moduleSpecifier ??
			pluginConfig.requestConfigTypeImportDeclaration.moduleSpecifier,
	};

	const requestErrorType: ImportDeclarationStructure = {
		kind: StructureKind.ImportDeclaration,
		namedImports: [requestTypes.responseErrorType],
		isTypeOnly: true,
		moduleSpecifier: requestTypes.moduleSpecifier ??
			pluginConfig.responseErrorTypeImportDeclaration.moduleSpecifier,
	};

	const requestErrorTypeAndRequestConfigType: ImportDeclarationStructure = {
		kind: StructureKind.ImportDeclaration,
		namedImports: [requestTypes.responseErrorType, requestTypes.requestConfigType],
		isTypeOnly: true,
		moduleSpecifier: requestTypes.moduleSpecifier ??
			pluginConfig.responseErrorTypeImportDeclaration.moduleSpecifier,
	};

	const mutationConfiguration: ImportDeclarationStructure = {
		kind: StructureKind.ImportDeclaration,
		namedImports: ["UseMutationOptions"],
		isTypeOnly: true,
		moduleSpecifier: "@tanstack/vue-query",
	};

	return [
		requestConfigType.moduleSpecifier === requestErrorType.moduleSpecifier
			? requestErrorTypeAndRequestConfigType
			: [...[requestErrorType, requestConfigType]],
		vueOptions,
		maybeRefOrGetter,
		...(isMutation
			? [useMutation, mutationConfiguration]
			: isInfinite
				? []
				: [useQuery, useQueryOptions]),
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
	] as Array<ImportDeclarationStructure>;
}
