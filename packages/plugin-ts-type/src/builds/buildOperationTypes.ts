import type { OperationWrapper } from "@openapi-to/core";
import { type StatementStructures, StructureKind } from "ts-morph";
import {
	buildCookieParamsTypes,
	buildHeaderParamsTypes,
	buildOperationRequestBodyTypes,
	buildPathParamsTypes,
	buildQueryParamsTypes,
	buildQuerystringType,
} from "@/builds/operation";
import type { InlineEnumSymbolResolver } from "@/utils/inlineEnumNaming.ts";
import { getOperationTSTypeName } from "../templates/operationTypeNameTemplate.ts";
import { buildJsonResponseTypes } from "./operation";

export function buildOperationTypes(
	operation: OperationWrapper,
	inlineEnumSymbols?: InlineEnumSymbolResolver,
): StatementStructures[] {
	const requestBodyTypes = buildOperationRequestBodyTypes(
		operation,
		inlineEnumSymbols,
	);
	const queryParamsTypes = buildQueryParamsTypes(operation, inlineEnumSymbols);
	const querystringType = buildQuerystringType(operation, inlineEnumSymbols);
	const pathParamsTypes = buildPathParamsTypes(operation, inlineEnumSymbols);
	const headerParamsTypes = buildHeaderParamsTypes(
		operation,
		inlineEnumSymbols,
	);
	const cookieParamsTypes = buildCookieParamsTypes(
		operation,
		inlineEnumSymbols,
	);
	const names = getOperationTSTypeName(operation);
	const groups = [
		pathParamsTypes ? `path: ${names.pathParams}` : "",
		queryParamsTypes
			? `query${operation.accessor.isQueryParametersOptional ? "?" : ""}: ${names.queryParams}${operation.accessor.isQueryParametersOptional ? " | undefined" : ""}`
			: "",
		querystringType
			? `querystring${operation.accessor.isQuerystringRequired ? "" : "?"}: ${names.querystring}${operation.accessor.isQuerystringRequired ? "" : " | undefined"}`
			: "",
		requestBodyTypes
			? `body${operation.accessor.isRequestBodyRequired ? "" : "?"}: ${names.body}${operation.accessor.isRequestBodyRequired ? "" : " | undefined"}`
			: "",
		headerParamsTypes
			? `headers${operation.accessor.isHeaderParametersOptional ? "?" : ""}: ${names.headerParams}${operation.accessor.isHeaderParametersOptional ? " | undefined" : ""}`
			: "",
		cookieParamsTypes
			? `cookies${operation.accessor.isCookieParametersOptional ? "?" : ""}: ${names.cookieParams}${operation.accessor.isCookieParametersOptional ? " | undefined" : ""}`
			: "",
	].filter(Boolean);
	return [
		...(pathParamsTypes ? [pathParamsTypes] : []),
		...(queryParamsTypes ? [queryParamsTypes] : []),
		...(querystringType ? [querystringType] : []),
		...(headerParamsTypes ? [headerParamsTypes] : []),
		...(cookieParamsTypes ? [cookieParamsTypes] : []),
		...(requestBodyTypes ? [requestBodyTypes] : []),
		{
			kind: StructureKind.TypeAlias,
			name: names.requestInput,
			isExported: true,
			type: groups.length
				? `{ ${groups.join("; ")}; }`
				: "Record<string, never>",
		},
		...buildJsonResponseTypes(operation, inlineEnumSymbols),
	];
}
