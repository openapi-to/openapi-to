import type { OperationWrapper } from "@openapi-to/core";
import { formatterModuleSpecifier, getRelativePath } from "@openapi-to/core/utils";
import type { ResolvedPluginConfig } from "../types.ts";

export function requestContract(operation: OperationWrapper, config: ResolvedPluginConfig, filePath?: string) {
	const request = operation.accessor.operationRequest;
	if (request?.transport !== "fetch") return {
		requestConfigType: config.requestConfigTypeImportDeclaration.namedImports[0] ?? "unknown",
		responseErrorType: config.responseErrorTypeImportDeclaration.namedImports[0] ?? "Error",
		moduleSpecifier: undefined,
	};
	return {
		requestConfigType: request.requestConfigTypeName ?? "FetchRequestConfig",
		responseErrorType: request.responseErrorTypeName ?? "FetchRequestError",
		moduleSpecifier: filePath && request.runtimeFilePath
			? formatterModuleSpecifier(getRelativePath(filePath, request.runtimeFilePath), config.importWithExtension)
			: undefined,
	};
}
