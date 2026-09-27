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
	const headerTransport = buildHeaderTransport(operation, pluginConfig);
	const bindings = [
		operation.accessor.hasQueryParameters ? "const params = input.query" : "",
		operation.accessor.hasRequestBody ? "const data = input.body" : "",
		headerTransport,
	]
		.filter(Boolean)
		.join(";\n");

	// 函数式策略模式 - 根据客户端类型处理请求
	return [
		bindings,
		chooseClientStrategy(pluginConfig.requestClient)(
			operation,
			requestFuncContent,
			pluginConfig,
		),
	]
		.filter(Boolean)
		.join("\n");
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
	const mergesHeaders = shouldMergeHeaders(operation, pluginConfig);
	return [
		`method:'${operation.method.toUpperCase()}'`,
		mergesHeaders ? "" : buildHeader(operation),
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
		mergesHeaders ? "headers: finalHeaders" : "",
		operation.accessor.hasQueryParametersArray
			? buildParamsSerializer(operation)
			: "",
	]
		.filter(Boolean)
		.join(",\n");
}

function shouldMergeHeaders(
	operation: OperationWrapper,
	pluginConfig: RequiredPluginConfig,
): boolean {
	return (
		operation.accessor.hasHeaderParameters ||
		!operation.accessor.isJsonContainsDefaultCases ||
		pluginConfig.requestClient === RequestClientEnum.COMMON
	);
}

function buildHeaderTransport(
	operation: OperationWrapper,
	pluginConfig: RequiredPluginConfig,
): string {
	if (!shouldMergeHeaders(operation, pluginConfig)) return "";
	const metadata = JSON.stringify(
		operation.accessor.headerParameterSerialization,
	);
	const hasParameters = operation.accessor.hasHeaderParameters;
	const required = !operation.accessor.isHeaderParametersOptional;
	const headerSchema = operation.accessor.operationZodSchema?.headerParams;
	const rawHeaderGuard = hasParameters
		? `const readSafeHeaderObject = (value: unknown, message: string): Record<string, unknown> => {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error();
    if (Object.getOwnPropertySymbols(value).length !== 0) throw new Error();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const record: Record<string, unknown> = Object.create(null);
    for (const name of Object.keys(descriptors)) {
      const descriptor = descriptors[name];
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error();
      record[name] = descriptor.value;
    }
    return record;
  } catch {
    throw new Error(message);
  }
};
const rawHeaders = input.headers === undefined ? undefined : readSafeHeaderObject(input.headers, 'OpenAPI request headers must be a plain object with data properties.');
if (rawHeaders !== undefined) {
  const rawNames = Object.keys(rawHeaders);
  const allowedNames = new Set<string>(${metadata}.map((item) => item.name.toLowerCase()));
  const seenNames = new Set<string>();
  for (const name of rawNames) {
    const identity = name.toLowerCase();
    if (seenNames.has(identity)) throw new Error('Duplicate case-insensitive OpenAPI request Header identity.');
    seenNames.add(identity);
    if (!allowedNames.has(identity)) throw new Error('Unknown OpenAPI request Header parameter.');
  }
}`
		: "";
	const parsedHeaders = !hasParameters
		? "const parsedHeaders = undefined;"
		: pluginConfig.parser === "zod" && headerSchema
			? `const parsedHeaders = rawHeaders === undefined && !${required} ? undefined : (() => { try { return ${headerSchema}.parse(rawHeaders); } catch { throw new Error('Invalid OpenAPI request Header values.'); } })();`
			: "const parsedHeaders = rawHeaders;";
	const serialize = hasParameters
		? `const headerParameterMetadata: Array<{ name: string; required: boolean; strategy: string; style: string; explode: boolean; schemaPresent: boolean; contentMediaType?: string }> = ${metadata};
const serializeHeaderValue = (value: unknown, explode: boolean): string => {
  const primitive = (item: unknown): string => {
    if (typeof item === 'string') return item;
    if (typeof item === 'boolean') return item ? 'true' : 'false';
    if (typeof item === 'number' && Number.isFinite(item)) return String(item);
    throw new Error('Unsupported OpenAPI Header value; expected a finite primitive or a bounded simple value.');
  };
  if (Array.isArray(value)) return value.map(primitive).join(',');
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const object = readSafeHeaderObject(value, 'Unsupported compound OpenAPI Header object value.');
    const entries = Object.keys(object).sort().flatMap((key) => {
      const item = object[key];
      return item === undefined ? [] : [[key, primitive(item)] as const];
    });
    return entries.map(([key, item]) => explode ? key + '=' + item : key + ',' + item).join(',');
  }
  return primitive(value);
};
const serializedHeaders: Record<string, string> = Object.create(null);
if (parsedHeaders === undefined) {
  if (${required}) throw new Error('Missing required OpenAPI request Header group.');
} else {
  if (parsedHeaders === null || typeof parsedHeaders !== 'object' || Array.isArray(parsedHeaders)) throw new Error('OpenAPI request headers must be a plain object.');
  const suppliedNames = Object.keys(parsedHeaders as Record<string, unknown>);
  const allowedNames = new Set<string>(headerParameterMetadata.map((item) => item.name.toLowerCase()));
  const seenNames = new Set<string>();
  for (const suppliedName of suppliedNames) {
    const identity = suppliedName.toLowerCase();
    if (seenNames.has(identity)) throw new Error('Duplicate case-insensitive OpenAPI request Header identity.');
    seenNames.add(identity);
    if (!allowedNames.has(identity)) throw new Error('Unknown OpenAPI request Header parameter.');
  }
  for (const item of headerParameterMetadata) {
    if (!/^[A-Za-z0-9!#$%&'*+.^_|~-]+$/.test(item.name)) throw new Error('Invalid OpenAPI request Header name.');
    const suppliedName = suppliedNames.find((name) => name.toLowerCase() === item.name.toLowerCase());
    const value = suppliedName === undefined ? undefined : (parsedHeaders as Record<string, unknown>)[suppliedName];
    if (value === undefined) {
      if (item.required) throw new Error('Missing required OpenAPI request Header value.');
      continue;
    }
    if (item.strategy === 'content') throw new Error('OpenAPI Header Parameter content serialization is unsupported.');
    if (item.style !== 'simple') throw new Error('Unsupported OpenAPI request Header style.');
    const serialized = serializeHeaderValue(value, item.explode);
    if (/[\\u0000-\\u0008\\u000A-\\u001F\\u007F]/.test(serialized)) throw new Error('Invalid HTTP Header field value.');
    serializedHeaders[item.name] = serialized;
  }
}`
		: "const serializedHeaders: Record<string, string> = Object.create(null);";
	const generatedHeaders = buildHeader(operation) || "{}";
	if (pluginConfig.requestClient === RequestClientEnum.COMMON) {
		const commonFinalHeadersType = `(NonNullable<typeof requestConfig> extends { headers?: infer Headers } ? Headers : never)`;
		return `${rawHeaderGuard}
${parsedHeaders}
${serialize}
const generatedHeaders: Record<string, unknown> = ${generatedHeaders};
let rawConfigHeaders: unknown;
try { rawConfigHeaders = (requestConfig as { headers?: unknown } | undefined)?.headers; }
catch { throw new Error('Unable to read requestConfig.headers safely.'); }
const toPlainHeaderRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (value === undefined || value === null) return undefined;
  try {
    if (typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error();
    if (Object.getOwnPropertySymbols(value).length !== 0) throw new Error();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const record: Record<string, unknown> = Object.create(null);
    for (const name of Object.keys(descriptors)) {
      const descriptor = descriptors[name];
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error();
      record[name] = descriptor.value;
    }
    return record;
  } catch {
    throw new Error('Unsupported requestConfig.headers container for the common request client; expected a plain object record with data properties.');
  }
};
const configHeaders = toPlainHeaderRecord(rawConfigHeaders);
const mergeCommonHeaders = (...layers: Array<Record<string, unknown> | undefined>): Record<string, unknown> => {
  const result: Record<string, unknown> = Object.create(null);
  const names = new Map<string, string>();
  for (const layer of layers) {
    if (!layer) continue;
    const layerNames = new Set<string>();
    for (const [name, value] of Object.entries(layer)) {
      const identity = name.toLowerCase();
      if (layerNames.has(identity)) throw new Error('Duplicate case-insensitive Header identity in one header bag.');
      layerNames.add(identity);
      const previousName = names.get(identity);
      if (previousName !== undefined) delete result[previousName];
      result[name] = value;
      names.set(identity, name);
    }
  }
  return result;
};
const finalHeaders = mergeCommonHeaders(generatedHeaders, serializedHeaders, configHeaders) as ${commonFinalHeadersType};`;
	}
	const axiosFinalHeadersType = `(NonNullable<typeof requestConfig> extends { headers?: infer Headers } ? Headers : never)`;
	return `${rawHeaderGuard}
${parsedHeaders}
${serialize}
const generatedHeaders: Record<string, unknown> = ${generatedHeaders};
const finalHeaders = AxiosHeaders.concat(generatedHeaders, serializedHeaders, requestConfig?.headers) as ${axiosFinalHeadersType};`;
}

/**
 * 构建请求头 - 纯函数
 */
const buildHeader = (operation: OperationWrapper): string =>
	operation.accessor.isJsonContainsDefaultCases
		? ""
		: `{
        'Content-Type':'${operation.accessor.operation.getContentType()}'
    }`;

/**
 * 构建参数序列化器 - 纯函数
 */
const buildParamsSerializer = (operation: OperationWrapper): string =>
	`paramsSerializer(params:${`${operation.accessor.operationTSType?.queryParams}`}) {
      return qs.stringify(params)
  }`;

/**
 * 构建 Axios 类型注解 - 纯函数
 */
const buildAxiosTypeAnnotation = (operation: OperationWrapper): string => {
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
