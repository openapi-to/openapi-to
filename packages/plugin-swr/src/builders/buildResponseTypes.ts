import type { OperationWrapper } from "@openapi-to/core";
import { isEmpty } from "lodash-es";
import type { PluginConfig } from "../types.ts";
import { requestContract } from "./requestContract.ts";

export function buildResponseTypes(
	operation: OperationWrapper,
	pluginConfig?: PluginConfig,
): { data: string | undefined; error: string | undefined } {
	const responseSuccess = operation.accessor.operationTSType?.responseSuccess;
	const responseError = operation.accessor.operationTSType?.responseError;
	const requestTypes = requestContract(operation, pluginConfig ?? {});
	const fetchResponse = operation.accessor.operationRequest?.transport === "fetch"
		? `Awaited<ReturnType<typeof ${operation.accessor.operationRequest.requestName}>>`
		: undefined;
	return {
		data: fetchResponse ?? (!isEmpty(
			pluginConfig?.responseConfigTypeImportDeclaration?.namedImports,
		)
			? `${pluginConfig?.responseConfigTypeImportDeclaration?.namedImports[0]}<${responseSuccess}>['data']`
			: responseSuccess),
		error: operation.accessor.operationRequest?.transport === "fetch"
			? `${requestTypes.responseErrorType}<${responseError}>`
			: !isEmpty(
			pluginConfig?.responseErrorTypeImportDeclaration?.namedImports,
		)
			? `${pluginConfig?.responseErrorTypeImportDeclaration?.namedImports[0]}<${responseError}>`
			: responseError,
	};
}
