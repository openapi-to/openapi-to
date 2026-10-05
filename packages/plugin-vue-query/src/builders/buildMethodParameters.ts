import { isQueryOperation, type OperationWrapper } from "@openapi-to/core";
import { camelCase } from "lodash-es";
import type { OptionalKind, ParameterDeclarationStructure } from "ts-morph";
import type { RequiredPluginConfig } from "../types.ts";
import { formatterQueryKeyTypeName } from "../utils/formatterQueryKey.ts";
import { requestContract } from "./requestContract.ts";

export function buildMethodParameters(
	operation: OperationWrapper,
	pluginConfig: RequiredPluginConfig,
): OptionalKind<ParameterDeclarationStructure>[] {
	const requestTypes = requestContract(operation, pluginConfig);
	const requestConfigType = requestTypes.requestConfigType;
	const requestConfigGeneric = operation.accessor.operationRequest?.transport === "fetch"
		? ""
		: `<${operation.accessor.operationTSType?.body || "never"}>`;
	const hasHeaders = operation.accessor.hasHeaderParameters;
	const hasCookies = operation.accessor.hasCookieParameters;
	const requiredHeaders =
		hasHeaders && !operation.accessor.isHeaderParametersOptional;
	const requiredCookies =
		hasCookies && !operation.accessor.isCookieParametersOptional;
	const requiredRequestOptions = requiredHeaders || requiredCookies;
	const headerType = operation.accessor.operationTSType?.headerParams;
	const cookieType = operation.accessor.operationTSType?.cookieParams;

	const queryParameters: OptionalKind<ParameterDeclarationStructure> = {
		name: "params",
		hasQuestionToken:
			operation.accessor.isQueryParametersOptional && !requiredRequestOptions,
		type: `MaybeRefOrGetter<${operation.accessor.operationTSType?.queryParams}>${requiredRequestOptions && operation.accessor.isQueryParametersOptional ? " | undefined" : ""}`,
	};
	const querystringParameter: OptionalKind<ParameterDeclarationStructure> = {
		name: 'querystring',
		hasQuestionToken: !operation.accessor.isQuerystringRequired && !requiredRequestOptions,
		type: `MaybeRefOrGetter<${operation.accessor.operationTSType?.querystring}>${requiredRequestOptions && !operation.accessor.isQuerystringRequired ? ' | undefined' : ''}`,
	};

	const pathParameters: OptionalKind<ParameterDeclarationStructure>[] =
		operation.accessor.pathParameters.map((item) => {
			return {
				name: camelCase(item.name),
				type: `MaybeRefOrGetter<${operation.accessor.operationTSType?.pathParams || ""}['${camelCase(item.name)}']>`,
			};
		});

	const options: OptionalKind<ParameterDeclarationStructure> = {
		name: requiredRequestOptions ? "options" : "options?",
		type: `{
    ${hasHeaders ? `headers${requiredHeaders ? "" : "?"}: MaybeRefOrGetter<${headerType}>\n    ` : ""}${hasCookies ? `cookies${requiredCookies ? "" : "?"}: MaybeRefOrGetter<${cookieType}>\n    ` : ""}requestConfig?: Partial<${requestConfigType}>
    query?: Partial<UseQueryOptions<
    TQueryFnData,
			${requestTypes.responseErrorType}<${operation.accessor.operationTSType?.responseError}>,
    TData,
    TQueryData,
    ${formatterQueryKeyTypeName(operation)}
    >>
    }`,
	};

	const mutationOptions: OptionalKind<ParameterDeclarationStructure> = {
		name: requiredRequestOptions ? "options" : "options?",
		type: `{
		${hasHeaders ? `headers${requiredHeaders ? "" : "?"}: MaybeRefOrGetter<${headerType}>\n        ` : ""}${hasCookies ? `cookies${requiredCookies ? "" : "?"}: MaybeRefOrGetter<${cookieType}>\n        ` : ""}requestConfig?: Partial<${requestConfigType}${requestConfigGeneric}>
        mutation?: UseMutationOptions<
        TData,
	        ${requestTypes.responseErrorType}<${operation.accessor.operationTSType?.responseError}>,
        TVariables,
        TContext
 >;
        }`,
	};
	const queryBody: OptionalKind<ParameterDeclarationStructure> | undefined =
		operation.sourceMethod === "query" && operation.accessor.hasRequestBody
			? {
					name: "data",
					hasQuestionToken: !operation.accessor.isRequestBodyRequired,
					type: `MaybeRefOrGetter<${operation.accessor.operationTSType?.body || "unknown"}>`,
				}
			: undefined;

	//GET method
	if (isQueryOperation(operation)) {
		const queryInputs = [
			...(queryBody ? [queryBody] : []),
			...(operation.accessor.hasQueryParameters ? [queryParameters] : []),
			...(operation.accessor.hasQuerystringParameter ? [querystringParameter] : []),
			...(operation.accessor.queryParameters.some(
				(x) => x.name === pluginConfig?.infinite?.pageNumParam,
			)
				? []
				: [options]),
		].sort(
			(left, right) =>
				Number(left.hasQuestionToken === true || left.name.endsWith("?")) -
				Number(right.hasQuestionToken === true || right.name.endsWith("?")),
		);
		return [
			...(operation.accessor.hasPathParameters ? pathParameters : []),
			...queryInputs,
		];
	}

	// not GET method

	return [
		...(operation.accessor.hasQueryParameters ? [queryParameters] : []),
		mutationOptions,
	];
}
