import type { OperationWrapper } from "@openapi-to/core";
import { OpenAPIV3 } from "openapi-types";
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

	if (operation.method === OpenAPIV3.HttpMethods.GET) {
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

	return `const { query: queryOptions, shouldFetch = true${operation.accessor.hasHeaderParameters ? ", headers" : ""} } = options ?? {}
  const queryKey = ${formatterQueryKeyName(operation)}(${operation.accessor.hasQueryParameters ? "params" : ""})

  return useSWRInfinite<
  ${responseConfigType},
  ${responseErrorType}, 
  ${formatterQueryKeyTypeName(operation)}
>(
    shouldFetch ? queryKey : ()=>null,
    {
      fetcher: async (dynamicParams: ${operation.accessor.operationTSType?.queryParams}) => {
        return ${operation.accessor.operationRequest?.requestName}({ ${operation.accessor.hasPathParameters ? `path: { ${operation.accessor.pathParameters.map((x) => x.name).join(", ")} }, ` : ""}query: dynamicParams${operation.accessor.hasHeaderParameters ? ", headers" : ""} }, options?.requestConfig)
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

	const pathParameters =
		operation.method === OpenAPIV3.HttpMethods.GET
			? operation.accessor.pathParameters.map((x) => x.name)
			: "";

	const input = [
		operation.accessor.hasPathParameters
			? `path: { ${operation.accessor.pathParameters.map((x) => x.name).join(", ")} }`
			: "",
		operation.accessor.hasQueryParameters ? "query: params" : "",
		operation.accessor.hasRequestBody ? "body: data" : "",
		operation.accessor.hasHeaderParameters ? "headers" : "",
	].filter(Boolean);
	const params = `{ ${input.join(", ")} }, options?.requestConfig`;

	return `
    const { query: queryOptions, shouldFetch = true${operation.accessor.hasHeaderParameters ? ", headers" : ""} } = options ?? {}
    const queryKey = ${formatterQueryKeyName(operation)}(${[pathParameters, operation.accessor.hasQueryParameters ? "params" : ""].filter(Boolean).join(",")})

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
		operation.accessor.hasRequestBody ? "body: data" : "",
		operation.accessor.hasHeaderParameters ? "headers" : "",
	].filter(Boolean);
	const params = `{ ${input.join(", ")} }, options?.requestConfig`;

	return `
    const { mutation: mutationOptions, shouldFetch = true${operation.accessor.hasHeaderParameters ? ", headers" : ""} } = options ?? {}
    const mutationKey = ${formatterQueryKeyName(operation)}()

    return useSWRMutation<
  ${responseConfigType},
  ${responseErrorType}, 
${formatterQueryKeyTypeName(operation)} | null,
${operation.accessor.operationTSType?.body}
>(
  shouldFetch ? mutationKey : null,
  async (_url, { arg: data }) => {
    return ${operation.accessor.operationRequest?.requestName}(${params})
  },
  mutationOptions
)`;
}
