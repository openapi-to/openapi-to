import { isMutationOperation, type OperationWrapper } from "@openapi-to/core";
import { upperFirst } from "lodash-es";

export function getResponseSuccessName(operation: OperationWrapper) {
	const operationName = operation.accessor.operationName;
	const isMutation = isMutationOperation(operation);
	return `${upperFirst(operationName)}${isMutation ? "Mutation" : ""}Response`;
}

export function getQueryParamsTypeName(operationName: string) {
	return `${upperFirst(operationName)}QueryParams`;
}

export function getQuerystringTypeName(operationName: string) {
	return `${upperFirst(operationName)}Querystring`;
}

export function getOperationPathParamsName(operationName: string) {
	return `${upperFirst(operationName)}PathParams`;
}

export function getHeaderParamsTypeName(operationName: string) {
	return `${upperFirst(operationName)}HeaderParams`;
}

export function getCookieParamsTypeName(operationName: string) {
	return `${upperFirst(operationName)}CookieParams`;
}

export function getRequestBodyTypeName(operationName: string) {
	return `${upperFirst(operationName)}MutationRequest`;
}

export function getResponseErrorTypeName(operationName: string) {
	return `${upperFirst(operationName)}ResponseError`;
}

export function getResponseStatusTypeName(
	responseName: string,
	statusCode: string,
) {
	const suffix =
		statusCode.toLowerCase() === "default"
			? "Default"
			: statusCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
	return `${responseName}${suffix}`;
}

export function getOperationTSTypeName(operation: OperationWrapper) {
	const operationName = operation.accessor.operationName;

	return {
		requestInput: `${upperFirst(operationName)}RequestInput`,
		pathParams: operation.accessor.hasPathParameters
			? getOperationPathParamsName(operationName)
			: undefined,
		queryParams: operation.accessor.hasQueryParameters
			? getQueryParamsTypeName(operationName)
			: undefined,
		querystring: operation.accessor.hasQuerystringParameter
			? getQuerystringTypeName(operationName)
			: undefined,
		headerParams: operation.accessor.hasHeaderParameters
			? getHeaderParamsTypeName(operationName)
			: undefined,
		cookieParams: operation.accessor.hasCookieParameters
			? getCookieParamsTypeName(operationName)
			: undefined,
		body: operation.accessor.hasRequestBody
			? getRequestBodyTypeName(operationName)
			: undefined,
		responseSuccess: getResponseSuccessName(operation),
		responseError: getResponseErrorTypeName(operationName),
	};
}
