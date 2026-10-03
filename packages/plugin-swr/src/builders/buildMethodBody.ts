import { isQueryOperation, type OperationWrapper } from "@openapi-to/core";
import type { PluginConfig } from "../types.ts";
import {
	formatterQueryKeyName,
	formatterQueryKeyTypeName,
} from "../utils/formatterQueryKey.ts";
import { buildResponseTypes } from "./buildResponseTypes.ts";

/**
 * 构建请求方法体
 * @param operation - 操作包装器
 * @param pluginConfig - 插件配置
 * @returns 生成的请求方法体字符串
 */
export function buildMethodBody(
	operation: OperationWrapper,
	pluginConfig?: PluginConfig,
): string {
	if (
		operation.accessor.queryParameters.some(
			(x) => x.name === pluginConfig?.infinite?.pageNumParam,
		)
	) {
		return infiniteMethodBody(operation, pluginConfig);
	}

	if (isQueryOperation(operation)) {
		return queryMethodBody(operation, pluginConfig);
	}

	return mutationMethodBody(operation, pluginConfig);
}

/**

 * @param operation
 * @param pluginConfig
 */
function infiniteMethodBody(
	operation: OperationWrapper,
	pluginConfig?: PluginConfig,
) {
	const { data: responseConfigType, error: responseErrorType } =
		buildResponseTypes(operation, pluginConfig);

	return `const { query: queryOptions, shouldFetch = true${operation.accessor.hasHeaderParameters ? ", headers" : ""}${operation.accessor.hasCookieParameters ? ", cookies" : ""} } = options ?? {}
  const queryKey = ${formatterQueryKeyName(operation)}(${operation.accessor.hasQueryParameters ? "params" : ""})

  return useSWRInfinite<
  ${responseConfigType},
  ${responseErrorType}, 
  ${formatterQueryKeyTypeName(operation)}
>(
    shouldFetch ? queryKey : ()=>null,
    {
      fetcher: async (dynamicParams: ${operation.accessor.operationTSType?.queryParams}) => {
	        return ${operation.accessor.operationRequest?.requestName}({ ${operation.accessor.hasPathParameters ? `path: { ${operation.accessor.pathParameters.map((x) => x.name).join(", ")} }, ` : ""}query: dynamicParams${operation.accessor.hasHeaderParameters ? ", headers" : ""}${operation.accessor.hasCookieParameters ? ", cookies" : ""} }, options?.requestConfig)
      },
      ...queryOptions
    }
  )`;
}

/**
 * 构建查询方法体
 * @param operation - 操作包装器
 * @param pluginConfig
 * @returns 生成的查询方法体字符串
 */
function queryMethodBody(
	operation: OperationWrapper,
	pluginConfig?: PluginConfig,
) {
	const { data: responseConfigType, error: responseErrorType } =
		buildResponseTypes(operation, pluginConfig);

	const pathParameters = isQueryOperation(operation)
		? operation.accessor.pathParameters.map((x) => x.name)
		: [];

	const input = [
		operation.accessor.hasPathParameters
			? `path: { ${operation.accessor.pathParameters.map((x) => x.name).join(", ")} }`
			: "",
		operation.accessor.hasQueryParameters ? "query: params" : "",
		operation.accessor.hasQuerystringParameter ? "querystring" : "",
		operation.sourceMethod === "query" && operation.accessor.hasRequestBody
			? "body: data"
			: "",
		operation.accessor.hasHeaderParameters ? "headers" : "",
		operation.accessor.hasCookieParameters ? "cookies: options?.cookies" : "",
	].filter(Boolean);
	const params = `{ ${input.join(", ")} }, options?.requestConfig`;
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

	return `
    const { query: queryOptions, shouldFetch = true${operation.accessor.hasHeaderParameters ? ", headers" : ""}${operation.accessor.hasCookieParameters ? ", cookies" : ""} } = options ?? {}
    const queryKey = ${formatterQueryKeyName(operation)}(${[...pathParameters, ...queryKeyInputs.map(({ name }) => name)].join(",")})

    return useSWR<
  ${responseConfigType},
  ${responseErrorType}, 
  ${formatterQueryKeyTypeName(operation)} | null
 >(shouldFetch ? queryKey : null, {
        ...queryOptions,
        fetcher: async () => {
            return ${operation.accessor.operationRequest?.requestName}(${params});
        }
    })`;
}

function mutationMethodBody(
	operation: OperationWrapper,
	pluginConfig?: PluginConfig,
) {
	const { data: responseConfigType, error: responseErrorType } =
		buildResponseTypes(operation, pluginConfig);

	const input = [
		operation.accessor.hasPathParameters
			? `path: { ${operation.accessor.pathParameters.map((x) => x.name).join(", ")} }`
			: "",
		operation.accessor.hasQueryParameters ? "query: params" : "",
		operation.accessor.hasQuerystringParameter ? "querystring: arg.querystring" : "",
		operation.accessor.hasRequestBody ? (operation.accessor.hasQuerystringParameter ? "body: arg.body" : "body: data") : "",
		operation.accessor.hasHeaderParameters ? "headers" : "",
		operation.accessor.hasCookieParameters ? "cookies: options?.cookies" : "",
	].filter(Boolean);
	const params = `{ ${input.join(", ")} }, options?.requestConfig`;

	const mutationArgumentType = operation.accessor.hasQuerystringParameter
		? `{ ${operation.accessor.hasRequestBody ? `body${operation.accessor.isRequestBodyRequired ? '' : '?'}: ${operation.accessor.operationTSType?.body}; ` : ''}querystring${operation.accessor.isQuerystringRequired ? '' : '?'}: ${operation.accessor.operationTSType?.querystring} }`
		: operation.accessor.operationTSType?.body ?? 'never';
	return `
    const { mutation: mutationOptions, shouldFetch = true${operation.accessor.hasHeaderParameters ? ", headers" : ""}${operation.accessor.hasCookieParameters ? ", cookies" : ""} } = options ?? {}
    const mutationKey = ${formatterQueryKeyName(operation)}()

    return useSWRMutation<
  ${responseConfigType},
  ${responseErrorType}, 
${formatterQueryKeyTypeName(operation)} | null,
${mutationArgumentType}
>(
  shouldFetch ? mutationKey : null,
  async (_url, { arg: ${operation.accessor.hasQuerystringParameter ? 'arg' : 'data'} }) => {
    return ${operation.accessor.operationRequest?.requestName}(${params})
  },
  mutationOptions
)`;
}
