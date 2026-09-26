import {
	buildCookieParamsTypes,
	buildHeaderParamsTypes,
	buildOperationRequestBodyTypes,
	buildPathParamsTypes,
	buildQueryParamsTypes,
} from "@/builds/operation";
import type { OperationWrapper } from "@openapi-to/core";
import { StructureKind, type StatementStructures } from "ts-morph";
import { getOperationTSTypeName } from "../templates/operationTypeNameTemplate.ts";
import type { InlineEnumSymbolResolver } from "@/utils/inlineEnumNaming.ts";
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
		queryParamsTypes ? `query${operation.accessor.isQueryParametersOptional ? "?" : ""}: ${names.queryParams}${operation.accessor.isQueryParametersOptional ? " | undefined" : ""}` : "",
		requestBodyTypes ? `body${operation.accessor.isRequestBodyRequired ? "" : "?"}: ${names.body}${operation.accessor.isRequestBodyRequired ? "" : " | undefined"}` : "",
	].filter(Boolean);
	return [
		...(pathParamsTypes ? [pathParamsTypes] : []),
		...(queryParamsTypes ? [queryParamsTypes] : []),
		...(headerParamsTypes ? [headerParamsTypes] : []),
		...(cookieParamsTypes ? [cookieParamsTypes] : []),
		...(requestBodyTypes ? [requestBodyTypes] : []),
		{
			kind: StructureKind.TypeAlias,
			name: names.requestInput,
			isExported: true,
			type: groups.length ? `{ ${groups.join("; ")}; }` : "Record<string, never>",
		},
		...buildJsonResponseTypes(operation, inlineEnumSymbols),
	];
}
