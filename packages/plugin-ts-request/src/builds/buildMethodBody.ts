import { isQueryOperation, type OperationWrapper } from "@openapi-to/core";
import { URLPath } from "@openapi-to/core/utils";
import { buildQuerystringTransport } from './querystringRuntime.ts';
import {
	type RequestClient,
	RequestClientEnum,
	type RequiredPluginConfig,
} from "../types.ts";


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
	const cookieTransport = buildCookieTransport(operation, pluginConfig);
	const bindings = [
		operation.accessor.hasQueryParameters ? "const params = input.query" : "",
		operation.accessor.hasRequestBody ? "const data = input.body" : "",
		operation.accessor.hasQuerystringParameter ? buildQuerystringTransport(operation) : "",
		cookieTransport,
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
	const wireMethod = operation.wireMethod ?? operation.method.toUpperCase();
	const methodLiteral = operation.sourceKind === "additional"
		? JSON.stringify(wireMethod)
		: `'${wireMethod}'`;
	return [
		`method:${methodLiteral}`,
		mergesHeaders ? "" : buildHeader(operation),
		`url:${url.requestPath.replace(/\$\{(\w+)\}/g, (_match, name: string) => `\${input.path.${name}}`)}${operation.accessor.hasQuerystringParameter ? " + (querystringText === undefined ? '' : '?' + querystringText)" : ""}`,
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
		operation.accessor.hasCookieParameters ||
		!operation.accessor.isJsonContainsDefaultCases ||
		pluginConfig.requestClient === RequestClientEnum.COMMON
	);
}

function buildCookieTransport(
	operation: OperationWrapper,
	pluginConfig: RequiredPluginConfig,
): string {
	if (!operation.accessor.hasCookieParameters) return "";
	if (
		operation.accessor.headerParameters.some(
			(parameter) => parameter.name.toLowerCase() === "cookie",
		)
	) {
		throw new Error(
			"An operation cannot combine an OpenAPI Cookie Header parameter with Cookie parameters.",
		);
	}
	const metadata = JSON.stringify(
		operation.accessor.cookieParameterSerialization,
	);
	if (operation.accessor.cookieParameterSerialization.length > 100) {
		throw new Error(
			"OpenAPI Cookie parameter count exceeds the supported limit.",
		);
	}
	const required = !operation.accessor.isCookieParametersOptional;
	const schema = operation.accessor.operationZodSchema?.cookieParams;
	const readInput = `let rawCookies: unknown;\ntry { rawCookies = (input as { cookies?: unknown }).cookies; } catch { throw new Error('Unable to read OpenAPI request Cookie input safely.'); }\nconst readSafeCookieObject = (value: unknown): Record<string, unknown> => { try { if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(); const prototype = Object.getPrototypeOf(value); if (prototype !== Object.prototype && prototype !== null) throw new Error(); if (Object.getOwnPropertySymbols(value).length !== 0) throw new Error(); const descriptors = Object.getOwnPropertyDescriptors(value); const names = Object.keys(descriptors); if (names.length > 100) throw new Error(); const record: Record<string, unknown> = Object.create(null); for (const name of names) { const descriptor = descriptors[name]; if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error(); record[name] = descriptor.value; } return record; } catch { throw new Error('OpenAPI request cookies must be a plain object with data properties.'); } };`;
	if (pluginConfig.cookieTransport !== "header") {
		return `${readInput}\nconst serializedCookies: Record<string, string> = Object.create(null);\nif (rawCookies !== undefined || ${required}) throw new Error('OpenAPI Cookie input requires pluginTSRequest cookieTransport: "header".');`;
	}
	const parse =
		pluginConfig.parser === "zod" && schema
			? `let parsedCookies: unknown;\nif (rawCookies === undefined) { if (${required}) throw new Error('Missing required OpenAPI request Cookie group.'); parsedCookies = undefined; } else { const safeCookies = readSafeCookieObject(rawCookies); try { parsedCookies = ${schema}.parse(safeCookies); } catch { throw new Error('Invalid OpenAPI request Cookie values.'); } }`
			: `const parsedCookies = rawCookies === undefined ? undefined : readSafeCookieObject(rawCookies);\nif (parsedCookies === undefined && ${required}) throw new Error('Missing required OpenAPI request Cookie group.');`;
	return `${readInput}
${parse}
const cookieParameterMetadata: Array<{ name: string; required: boolean; strategy: string; style: string; explode: boolean; schemaType?: string; contentMediaType?: string; dialect: string }> = ${metadata};
const cookieToken = /^[!#$%&'*+.^_\\x60|~0-9A-Za-z-]+$/;
const isCookieOctet = (value: string): boolean => { for (const char of value) { const code = char.charCodeAt(0); if (!(code === 0x21 || (code >= 0x23 && code <= 0x2b) || (code >= 0x2d && code <= 0x3a) || (code >= 0x3c && code <= 0x5b) || (code >= 0x5d && code <= 0x7e))) return false; } return true; };
const safePrimitive = (value: unknown, dialect: string, style: string): string => {
  let text: string;
  if (typeof value === 'string') text = value;
  else if (typeof value === 'boolean') text = value ? 'true' : 'false';
  else if (typeof value === 'number' && Number.isFinite(value)) text = String(value);
  else throw new Error('Unsupported OpenAPI Cookie value; expected a safe primitive.');
  if (!isCookieOctet(text)) throw new Error('Invalid OpenAPI Cookie value; caller must provide a valid Cookie value.');
  if (dialect !== '3.2' || style === 'form') {
    if (!/^[A-Za-z0-9._~-]*$/.test(text)) throw new Error('OpenAPI Cookie value requires unsupported percent-encoding.');
  }
  return text;
};
const cookiePairs: Array<readonly [string, string, number]> = [];
let cookieHeaderLength = 0;
if (parsedCookies !== undefined) {
  const cookieInput = readSafeCookieObject(parsedCookies);
  const knownNames = new Set(cookieParameterMetadata.map((item) => item.name));
  for (const name of Object.keys(cookieInput)) if (!knownNames.has(name)) throw new Error('Unknown OpenAPI request Cookie parameter.');
  for (let index = 0; index < cookieParameterMetadata.length; index += 1) {
    const item = cookieParameterMetadata[index]!;
    if (item.strategy === 'content') throw new Error('OpenAPI Cookie Parameter content serialization is unsupported.');
    if (item.dialect === 'unknown') throw new Error('Unsupported OpenAPI Cookie dialect.');
    const value = cookieInput[item.name];
    if (value === undefined) { if (item.required) throw new Error('Missing required OpenAPI request Cookie value.'); continue; }
    if (!cookieToken.test(item.name)) throw new Error('Invalid OpenAPI Cookie parameter name.');
    if (item.dialect === '3.2' && !item.explode) throw new Error('OpenAPI 3.2 Cookie parameters require explode: true.');
    if (item.style !== 'form' && !(item.dialect === '3.2' && item.style === 'cookie')) throw new Error('Unsupported OpenAPI Cookie style.');
    const pushPair = (name: string, raw: unknown) => { if (!cookieToken.test(name)) throw new Error('Invalid OpenAPI Cookie pair name.'); const value = safePrimitive(raw, item.dialect, item.style); const nextLength = cookieHeaderLength + (cookiePairs.length === 0 ? 0 : 2) + name.length + 1 + value.length; if (nextLength > 8192) throw new Error('OpenAPI Cookie header exceeds the supported size limit.'); cookieHeaderLength = nextLength; cookiePairs.push([name, value, index]); };
	if (Array.isArray(value)) {
	  if (item.dialect !== '3.2' || item.style !== 'cookie' || item.schemaType !== 'array') throw new Error('Unsupported OpenAPI Cookie array serialization.');
	  if (value.length > 100) throw new Error('OpenAPI Cookie array exceeds the supported item limit.');
	  for (const entry of value) pushPair(item.name, entry);
	} else if (value !== null && typeof value === 'object') {
	  if (item.dialect !== '3.2' || item.style !== 'cookie' || item.schemaType !== 'object') throw new Error('Unsupported OpenAPI Cookie object serialization.');
	  const object = readSafeCookieObject(value);
	  const keys = Object.keys(object).sort();
	  if (keys.length > 100) throw new Error('OpenAPI Cookie object exceeds the supported property limit.');
	  for (const key of keys) pushPair(key, object[key]);
    } else pushPair(item.name, value);
  }
}
const cookieNames = new Map<string, number>();
for (const [name, _value, source] of cookiePairs) {
	const priorSource = cookieNames.get(name);
	const item = cookieParameterMetadata[source]!;
	const repeatedArrayPair = priorSource === source && item.dialect === '3.2' && item.style === 'cookie' && item.schemaType === 'array';
	if (priorSource !== undefined && !repeatedArrayPair) throw new Error('Conflicting OpenAPI Cookie parameter names.');
	cookieNames.set(name, source);
}
const serializedCookies: Record<string, string> = Object.create(null);
if (cookiePairs.length) {
  const cookieHeader = cookiePairs.map(([name, value]) => name + '=' + value).join('; ');
  if (cookieHeader.length > 8192) throw new Error('OpenAPI Cookie header exceeds the supported size limit.');
  serializedCookies.Cookie = cookieHeader;
}`;
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
	const rawNames = Object.keys(rawHeaders as Record<string, unknown>);
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
		let value: unknown;
		for (const suppliedName of suppliedNames) {
			if (suppliedName.toLowerCase() === item.name.toLowerCase()) {
				value = (parsedHeaders as Record<string, unknown>)[suppliedName];
				break;
			}
		}
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
		const cookieHeaders = operation.accessor.hasCookieParameters
			? ", ...serializedCookies"
			: "";
		return `${rawHeaderGuard}
${parsedHeaders}
${serialize}
const serializedInputHeaders = { ...serializedHeaders${cookieHeaders} };
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
const finalHeaders = mergeCommonHeaders(generatedHeaders, serializedInputHeaders, configHeaders) as ${commonFinalHeadersType};`;
	}
	const axiosFinalHeadersType = `(NonNullable<typeof requestConfig> extends { headers?: infer Headers } ? Headers : never)`;
	const cookieHeaders = operation.accessor.hasCookieParameters
		? ", ...serializedCookies"
		: "";
	return `${rawHeaderGuard}
${parsedHeaders}
${serialize}
const serializedInputHeaders = { ...serializedHeaders${cookieHeaders} };
const generatedHeaders: Record<string, unknown> = ${generatedHeaders};
const finalHeaders = AxiosHeaders.concat(generatedHeaders, serializedInputHeaders, requestConfig?.headers) as ${axiosFinalHeadersType};`;
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
		isQueryOperation(operation)
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
