import { isQueryOperation, type OperationWrapper } from "@openapi-to/core";
import { isEmpty } from "lodash-es";
import type { PluginConfig, RequiredPluginConfig } from "../types.ts";
import {
	formatterQueryKeyName,
	formatterQueryKeyTypeName,
} from "../utils/formatterQueryKey.ts";
import { hasPlaceholderData } from "../utils/hasPlaceholderData.ts";

/**
 * 构建请求方法体
 * @param operation - 操作包装器
 * @param pluginConfig - 插件配置
 * @returns 生成的请求方法体字符串
 */
export function buildMethodBody(
	operation: OperationWrapper,
	pluginConfig: RequiredPluginConfig,
): string {
	if (
		operation.accessor.queryParameters.some(
			(x) => x.name === pluginConfig?.infinite?.pageNumParam,
		)
	) {
		//todo: infinite query
		return "";
	}

	if (isQueryOperation(operation)) {
		return queryMethodBody(operation, pluginConfig);
	}

	return mutationMethodBody(operation, pluginConfig);
}

/**
 * 构建查询方法体
 * @param operation - 操作包装器
 * @param pluginConfig
 * @returns 生成的查询方法体字符串
 */
function queryMethodBody(
	operation: OperationWrapper,
	pluginConfig: RequiredPluginConfig,
) {
	const responseErrorType = `${pluginConfig?.responseErrorTypeImportDeclaration?.namedImports[0]}<${operation.accessor.operationTSType?.responseError}>`;

	const pathParameters = isQueryOperation(operation)
		? operation.accessor.pathParameters.map((x) => `toValue(${x.name})`)
		: [];

	const input = [
		operation.accessor.hasPathParameters
			? `path: { ${operation.accessor.pathParameters.map((x) => `${x.name}: toValue(${x.name})`).join(", ")} }`
			: "",
		operation.accessor.hasQueryParameters ? "query: toValue(params)" : "",
		operation.accessor.hasQuerystringParameter ? "querystring: toValue(querystring)" : "",
		operation.sourceMethod === "query" && operation.accessor.hasRequestBody
			? "body: toValue(data)"
			: "",
		operation.accessor.hasHeaderParameters ? "headers: toValue(headers)" : "",
		operation.accessor.hasCookieParameters ? "cookies: toValue(cookies)" : "",
	].filter(Boolean);
	const params = `{ ${input.join(", ")} }, requestConfig`;
	const queryKeyInputs = [
		...(operation.sourceMethod === "query" && operation.accessor.hasRequestBody
			? [{ name: "data", optional: !operation.accessor.isRequestBodyRequired }]
			: []),
		...(operation.accessor.hasQueryParameters
			? [
					{
						name: "params",
						optional: operation.accessor.isQueryParametersOptional,
					},
				]
			: []),
		...(operation.accessor.hasQuerystringParameter ? [{ name: 'querystring', optional: !operation.accessor.isQuerystringRequired }] : []),
	].sort((left, right) => Number(left.optional) - Number(right.optional));

	const hasPlaceholder = hasPlaceholderData(
		pluginConfig.placeholderData,
		operation.path,
	);

	return `
    const { query: userQueryOptions,requestConfig={} ${operation.accessor.hasHeaderParameters ? ", headers" : ""}${operation.accessor.hasCookieParameters ? ", cookies" : ""} } = options ?? {}
    const queryKey = ${formatterQueryKeyName(operation)}(${[...pathParameters, ...queryKeyInputs.map(({ name }) => name)].filter(Boolean).join(",")})

    return useQuery<
    TQueryFnData,
    ${responseErrorType},
    TData, 
    ${formatterQueryKeyTypeName(operation)} 
 >({
     ...queryOptions({
        queryKey,
        queryFn: async ({ signal }) => {
        requestConfig.signal = signal
            return ${operation.accessor.operationRequest?.requestName}(${params});
        }${hasPlaceholder ? "," : ""}
        ${hasPlaceholder ? `placeholderData:${pluginConfig.placeholderData.value}` : ""}
     }),
      ...userQueryOptions
    })`;
}

function mutationMethodBody(
	operation: OperationWrapper,
	pluginConfig?: PluginConfig,
) {
	const hasResponseError = !isEmpty(
		pluginConfig?.responseErrorTypeImportDeclaration?.namedImports,
	);

	const responseErrorType = hasResponseError
		? `${pluginConfig?.responseErrorTypeImportDeclaration?.namedImports[0]}<${operation.accessor.operationTSType?.responseError}>`
		: operation.accessor.operationTSType?.responseError;

	const input = [
		operation.accessor.hasPathParameters
			? `path: { ${operation.accessor.pathParameters.map((x) => `${x.name}: toValue(${x.name})`).join(", ")} }`
			: "",
		operation.accessor.hasQueryParameters ? "query: toValue(params)" : "",
		operation.accessor.hasQuerystringParameter ? "querystring: toValue(querystring)" : "",
		operation.accessor.hasRequestBody ? "body: toValue(data)" : "",
		operation.accessor.hasHeaderParameters ? "headers: toValue(headers)" : "",
		operation.accessor.hasCookieParameters ? "cookies: toValue(cookies)" : "",
	].filter(Boolean);
	const params = `{ ${input.join(", ")} }, requestConfig`;

	const variables = [
		...(!isQueryOperation(operation)
			? operation.accessor.pathParameters.map((x) => `${x.name}`)
			: ""),
		operation.accessor.hasRequestBody ? "data" : "",
		operation.accessor.hasQuerystringParameter ? "querystring" : "",
	]
		.filter(Boolean)
		.join(",");

	return `
    const { mutation:mutationOptions={},requestConfig={} ${operation.accessor.hasHeaderParameters ? ", headers" : ""}${operation.accessor.hasCookieParameters ? ", cookies" : ""} } = options ?? {}
    const mutationKey = ${formatterQueryKeyName(operation)}()
   
    return useMutation<
    TData,
    ${responseErrorType}, 
    TVariables,
    TContext
>({
  mutationKey,
  mutationFn :({${variables}}) => {
    return ${operation.accessor.operationRequest?.requestName}(${params})
  },
  ...mutationOptions
})`;
}
