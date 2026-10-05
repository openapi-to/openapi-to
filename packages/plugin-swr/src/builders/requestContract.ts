import type { OperationWrapper } from "@openapi-to/core";
import { formatterModuleSpecifier, getRelativePath } from "@openapi-to/core/utils";
import type { PluginConfig } from "../types.ts";

export function requestContract(operation: OperationWrapper, config: PluginConfig, filePath?: string) {
	const request = operation.accessor.operationRequest;
	if (request?.transport !== "fetch") return { responseErrorType: config.responseErrorTypeImportDeclaration?.namedImports?.[0], moduleSpecifier: undefined };
	return {
		responseErrorType: request.responseErrorTypeName ?? "FetchRequestError",
		moduleSpecifier: filePath && request.runtimeFilePath
			? formatterModuleSpecifier(getRelativePath(filePath, request.runtimeFilePath), config.importWithExtension ?? true)
			: undefined,
	};
}
