import type { OperationWrapper } from "@openapi-to/core";
import { formatterModuleSpecifier, getRelativePath } from "@openapi-to/core/utils";
import type { RequiredPluginConfig } from "../types.ts";

export function requestContract(operation: OperationWrapper, config: RequiredPluginConfig, filePath?: string) {
	const request = operation.accessor.operationRequest;
	if (request?.transport !== "fetch") return {
		requestConfigType: config.requestConfigTypeImportDeclaration?.namedImports?.[0] ?? "AxiosRequestConfig",
		responseErrorType: config.responseErrorTypeImportDeclaration?.namedImports?.[0] ?? "AxiosError",
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
