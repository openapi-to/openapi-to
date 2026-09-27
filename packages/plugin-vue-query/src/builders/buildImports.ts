import type { OperationWrapper } from "@openapi-to/core";
import {
	formatterModuleSpecifier,
	getRelativePath,
} from "@openapi-to/core/utils";
import { OpenAPIV3 } from "openapi-types";
import { type ImportDeclarationStructure, StructureKind } from "ts-morph";
import type { RequiredPluginConfig } from "../types.ts";
import { hasPlaceholderData } from "../utils/hasPlaceholderData.ts";

import HttpMethods = OpenAPIV3.HttpMethods;

export function buildImports(
	filePath: string,
	operation: OperationWrapper,
	pluginConfig: RequiredPluginConfig,
): Array<ImportDeclarationStructure> {
	const request = operation.accessor.operationRequest;
	const operationType = operation.accessor.operationTSType;

	const isMutation = operation.method !== HttpMethods.GET;
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
		namedImports: pluginConfig.requestConfigTypeImportDeclaration.namedImports,
		isTypeOnly: true,
		moduleSpecifier:
			pluginConfig.requestConfigTypeImportDeclaration.moduleSpecifier,
	};

	const requestErrorType: ImportDeclarationStructure = {
		kind: StructureKind.ImportDeclaration,
		namedImports: pluginConfig.responseErrorTypeImportDeclaration.namedImports,
		isTypeOnly: true,
		moduleSpecifier:
			pluginConfig.responseErrorTypeImportDeclaration.moduleSpecifier,
	};

	const requestErrorTypeAndRequestConfigType: ImportDeclarationStructure = {
		kind: StructureKind.ImportDeclaration,
		namedImports: [
			...pluginConfig.responseErrorTypeImportDeclaration.namedImports,
			...pluginConfig.requestConfigTypeImportDeclaration.namedImports,
		],
		isTypeOnly: true,
		moduleSpecifier:
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
					operationType?.body,
					operationType?.headerParams,
					operationType?.responseSuccess,
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
