import { isMutationOperation, type OperationWrapper } from "@openapi-to/core";
import { lowerFirst } from "lodash-es";

export function getResponseSuccessName(operation: OperationWrapper) {
	const operationName = operation.accessor.operationName;
	const isMutation = isMutationOperation(operation);
	return `${operationName}${isMutation ? "MutationSchema" : ""}ResponseSchema`;
}

export function getQueryParamsTypeName(operationName: string) {
	return `${lowerFirst(operationName)}QueryParamsSchema`;
}

export function getOperationPathParamsName(operationName: string) {
	return `${lowerFirst(operationName)}PathParamsSchema`;
}

export function getHeaderParamsTypeName(operationName: string) {
	return `${lowerFirst(operationName)}HeaderParamsSchema`;
}

export function getCookieParamsTypeName(operationName: string) {
	return `${lowerFirst(operationName)}CookieParamsSchema`;
}

export function getRequestBodyTypeName(operationName: string) {
	return `${operationName}MutationRequestSchema`;
}

export function getResponseErrorTypeName(operationName: string) {
	return `${operationName}ResponseErrorSchema`;
}

export function getResponseStatusSchemaName(
	responseName: string,
	statusCode: string,
) {
	const suffix =
		statusCode.toLowerCase() === "default"
			? "Default"
			: statusCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
	return `${responseName}${suffix}`;
}

export function getOperationZodSchemaName(operation: OperationWrapper) {
	const operationName = operation.accessor.operationName;

	return {
		body: operation.accessor.hasRequestBody
			? getRequestBodyTypeName(operationName)
			: "",
		responseSuccess: getResponseSuccessName(operation),
		headerParams: operation.accessor.hasHeaderParameters
			? getHeaderParamsTypeName(operationName)
			: "",
		cookieParams: operation.accessor.hasCookieParameters
			? getCookieParamsTypeName(operationName)
			: "",
	};
}
