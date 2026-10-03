import { isQueryOperation, type OperationWrapper } from "@openapi-to/core";
import { camelCase } from "lodash-es";
import type { OptionalKind, ParameterDeclarationStructure } from "ts-morph";
import type { PluginConfig } from "../types.ts";
import { formatterQueryKeyTypeName } from "../utils/formatterQueryKey.ts";
import { buildResponseTypes } from "./buildResponseTypes.ts";

export function buildMethodParameters(
	operation: OperationWrapper,
	pluginConfig?: PluginConfig,
): OptionalKind<ParameterDeclarationStructure>[] {
	const hasHeaders = operation.accessor.hasHeaderParameters;
	const hasCookies = operation.accessor.hasCookieParameters;
	const requiredHeaders =
		hasHeaders && !operation.accessor.isHeaderParametersOptional;
	const requiredCookies =
		hasCookies && !operation.accessor.isCookieParametersOptional;
	const requiredRequestOptions = requiredHeaders || requiredCookies;
	const headerType = operation.accessor.operationTSType?.headerParams;
	const cookieType = operation.accessor.operationTSType?.cookieParams;
	const { data: responseConfigType, error: responseErrorType } =
		buildResponseTypes(operation, pluginConfig);
	const queryParameters: OptionalKind<ParameterDeclarationStructure> = {
		name: "params",
		hasQuestionToken:
			operation.accessor.isQueryParametersOptional && !requiredRequestOptions,
		type: `${operation.accessor.operationTSType?.queryParams}${requiredRequestOptions && operation.accessor.isQueryParametersOptional ? " | undefined" : ""}`,
	};
	const querystringParameter: OptionalKind<ParameterDeclarationStructure> = {
		name: 'querystring',
		hasQuestionToken: !operation.accessor.isQuerystringRequired && !requiredRequestOptions,
		type: `${operation.accessor.operationTSType?.querystring}${requiredRequestOptions && !operation.accessor.isQuerystringRequired ? ' | undefined' : ''}`,
	};
	const mutationArgumentType = operation.accessor.hasQuerystringParameter
		? `{ ${operation.accessor.hasRequestBody ? `body${operation.accessor.isRequestBodyRequired ? '' : '?'}: ${operation.accessor.operationTSType?.body}; ` : ''}querystring${operation.accessor.isQuerystringRequired ? '' : '?'}: ${operation.accessor.operationTSType?.querystring} }`
		: operation.accessor.operationTSType?.body ?? 'never';

	const pathParameters: OptionalKind<ParameterDeclarationStructure>[] =
		operation.accessor.pathParameters.map((item) => {
			return {
				name: camelCase(item.name),
				type: `${operation.accessor.operationTSType?.pathParams || ""}['${camelCase(item.name)}']`,
			};
		});

	const options: OptionalKind<ParameterDeclarationStructure> = {
		name: requiredRequestOptions ? "options" : "options?",
		type: `{
    ${hasHeaders ? `headers${requiredHeaders ? "" : "?"}: ${headerType}\n    ` : ""}${hasCookies ? `cookies${requiredCookies ? "" : "?"}: ${cookieType}\n    ` : ""}requestConfig?: Parameters<typeof ${operation.accessor.operationRequest?.requestName}>[1]
    query?: SWRConfiguration<${responseConfigType}, ${responseErrorType}, Fetcher<${responseConfigType}, ${formatterQueryKeyTypeName(operation)}>>
    shouldFetch?: boolean
    }`,
	};

	const mutationOptions: OptionalKind<ParameterDeclarationStructure> = {
		name: requiredRequestOptions ? "options" : "options?",
		type: `{
        ${hasHeaders ? `headers${requiredHeaders ? "" : "?"}: ${headerType}\n        ` : ""}${hasCookies ? `cookies${requiredCookies ? "" : "?"}: ${cookieType};\n        ` : ""}requestConfig?: Parameters<typeof ${operation.accessor.operationRequest?.requestName}>[1]
        mutation?: SWRMutationConfiguration<${responseConfigType},  ${responseErrorType}, ${formatterQueryKeyTypeName(operation)} | null, ${mutationArgumentType}>;
        shouldFetch?: boolean;
        }`,
	};

	const infiniteOptions: OptionalKind<ParameterDeclarationStructure> = {
		name: requiredRequestOptions ? "options" : "options?",
		type: `{
      ${hasHeaders ? `headers${requiredHeaders ? "" : "?"}: ${headerType}\n      ` : ""}${hasCookies ? `cookies${requiredCookies ? "" : "?"}: ${cookieType}\n      ` : ""}requestConfig?: Parameters<typeof ${operation.accessor.operationRequest?.requestName}>[1]
      query?: Parameters<typeof useSWRInfinite<${responseConfigType},${responseErrorType}, ${formatterQueryKeyTypeName(operation)} | null>>[2]
      shouldFetch?: boolean
    }`,
	};
	const queryBody: OptionalKind<ParameterDeclarationStructure> | undefined =
		operation.sourceMethod === "query" && operation.accessor.hasRequestBody
			? {
					name: "data",
					hasQuestionToken: !operation.accessor.isRequestBodyRequired,
					type: operation.accessor.operationTSType?.body || "unknown",
				}
			: undefined;
	const queryInputs = [
		...(queryBody ? [queryBody] : []),
		...(operation.accessor.hasQueryParameters ? [queryParameters] : []),
		...(operation.accessor.hasQuerystringParameter ? [querystringParameter] : []),
		...(operation.accessor.queryParameters.some(
			(x) => x.name === pluginConfig?.infinite?.pageNumParam,
		)
			? [infiniteOptions]
			: [options]),
	].sort(
		(left, right) =>
			Number(left.hasQuestionToken === true || left.name.endsWith("?")) -
			Number(right.hasQuestionToken === true || right.name.endsWith("?")),
	);

	return [
		...(operation.accessor.hasPathParameters ? pathParameters : []),
		...(!isQueryOperation(operation)
			? [
					...(operation.accessor.hasQueryParameters ? [queryParameters] : []),
					mutationOptions,
				]
			: queryInputs),
	];
}
