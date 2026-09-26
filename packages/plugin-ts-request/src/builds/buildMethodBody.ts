import type { OperationWrapper } from "@openapi-to/core";
import { URLPath } from "@openapi-to/core/utils";
import { OpenAPIV3 } from "openapi-types";
import {
	type RequestClient,
	RequestClientEnum,
	type RequiredPluginConfig,
} from "../types.ts";

import HttpMethods = OpenAPIV3.HttpMethods;

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
	// 使用函数组合构建请求配置内容
	const requestFuncContent = buildRequestConfig(operation, pluginConfig);
	const bindings = [
		operation.accessor.hasQueryParameters ? "const params = input.query" : "",
		operation.accessor.hasRequestBody ? "const data = input.body" : "",
	].filter(Boolean).join(";\n");

	// 函数式策略模式 - 根据客户端类型处理请求
	return [bindings, chooseClientStrategy(pluginConfig.requestClient)(
		operation,
		requestFuncContent,
		pluginConfig,
	)].filter(Boolean).join("\n");
}

/**
 * 构建请求配置
 */
function buildRequestConfig(
	operation: OperationWrapper,
	pluginConfig: RequiredPluginConfig,
): string {
	const url = new URLPath(<string>operation.accessor.operation.path);
	const schemaName = operation.accessor.operationZodSchema?.body;
	return [
		`method:'${operation.method.toUpperCase()}'`,
		buildHeader(operation),
		`url:${url.requestPath.replace(/\$\{(\w+)\}/g, (_match, name: string) => `\${input.path.${name}}`)}`,
		operation.accessor.hasQueryParameters ? "params" : "",
		operation.accessor.hasRequestBody
			? pluginConfig.parser === "zod"
				? operation.accessor.isRequestBodyRequired
					? `data:${schemaName}.parse(data)`
					: `data:data === undefined ? undefined : ${schemaName}.parse(data)`
				: "data"
			: "",
		operation.accessor.isDownLoad ? "responseType:'blob'" : "",
		"...requestConfig",
		operation.accessor.hasQueryParametersArray
			? buildParamsSerializer(operation)
			: "",
	]
		.filter(Boolean)
		.join(",\n");
}

/**
 * 构建请求头 - 纯函数
 */
const buildHeader = (operation: OperationWrapper): string =>
	operation.accessor.isJsonContainsDefaultCases
		? ""
		: `headers:{
        'Content-Type':'${operation.accessor.operation.getContentType()}'
    }`;

/**
 * 构建参数序列化器 - 纯函数
 */
const buildParamsSerializer = (
	operation: OperationWrapper,
): string =>
	`paramsSerializer(params:${`${operation.accessor.operationTSType?.queryParams}`}) {
      return qs.stringify(params)
  }`;

/**
 * 构建 Axios 类型注解 - 纯函数
 */
const buildAxiosTypeAnnotation = (
	operation: OperationWrapper,
): string => {
	const requestData = operation.accessor.hasRequestBody
		? operation.accessor.operationTSType?.body
		: undefined;
	const responseConfigType = `AxiosResponse<${operation.accessor.operationTSType?.responseSuccess}${requestData ? `,${requestData}` : ""}>`;

	return `<${operation.accessor.operationTSType?.responseSuccess},${responseConfigType}${requestData ? `,${requestData}` : ""}>`;
};

/**
 * 通用客户端处理策略 - 纯函数
 */
const commonClientStrategy = (
	operation: OperationWrapper,
	requestFuncContent: string,
	pluginConfig: RequiredPluginConfig,
): string =>
	`const res = await request<${operation.accessor.operationTSType?.responseSuccess}>({
     ${requestFuncContent}
  })
  ${pluginConfig.parser === "zod" ? `return { ...res, data: ${operation.accessor.operationZodSchema?.responseSuccess}.parse(res.data) }` : "return res.data"}`;

const formDataConfig = () => {
	return `
      const formData = new FormData()
      if (data) {
        Object.keys(data).forEach((key) => {
          const value = data[key as keyof typeof data]
          if (typeof value === 'string' || (value as unknown) instanceof Blob) {
            formData.append(key, value as unknown as string | Blob)
          }
        })
      }
  `;
};

/**
 * Axios 客户端处理策略 - 纯函数
 */
const axiosClientStrategy = (
	operation: OperationWrapper,
	requestFuncContent: string,
	pluginConfig: RequiredPluginConfig,
): string => {
	const formData =
		operation.accessor.operation.getContentType() === "multipart/form-data"
			? formDataConfig()
			: "";

	//只在get方法中使用 dataReturnType
	const dataKey =
		operation.method === HttpMethods.GET
			? operation.accessor?.dataReturnType.find(
					(item) => item === pluginConfig.dataReturnType,
				)
			: "";

	const result = `return res.data${dataKey ? `.${dataKey}` : ""}`;

	const zodResult = `return { ...res, data: ${operation.accessor.operationZodSchema?.responseSuccess}${dataKey ? `.shape.\`${dataKey}\`` : ""}.parse(${result}) }`;

	return [
		formData,
		`const res = await request${buildAxiosTypeAnnotation(operation)}({
     ${requestFuncContent}
  })
    ${pluginConfig.parser === "zod" ? zodResult : result}`,
	]
		.filter(Boolean)
		.join("\n");
};
/**
 * 选择客户端策略 - 高阶函数实现策略模式
 */
const chooseClientStrategy = (clientType?: RequestClient) =>
	clientType === RequestClientEnum.COMMON
		? commonClientStrategy
		: axiosClientStrategy;
