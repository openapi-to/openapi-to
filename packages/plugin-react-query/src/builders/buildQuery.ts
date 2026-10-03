import type { OperationWrapper } from "@openapi-to/core";
import { camelCase } from "lodash-es";
import type { ResolvedPluginConfig } from "../types.ts";
import {
	queryConfigName,
	queryConfigTypeName,
	queryHookName,
	queryKeyName,
	queryKeyTypeName,
	queryOptionsName,
	queryParameterName,
	querystringParameterName,
	querySignalName,
} from "./names.ts";

function typeName(value: string | undefined, fallback: string): string {
	return value ?? fallback;
}

function pathParameters(operation: OperationWrapper): string[] {
	return operation.accessor.pathParameters.map((parameter) =>
		camelCase(parameter.name),
	);
}

function pathParameterType(operation: OperationWrapper, name: string): string {
	return `${typeName(operation.accessor.operationTSType?.pathParams, "Record<string, never>")}['${name}']`;
}

function queryType(operation: OperationWrapper): string {
	return typeName(
		operation.accessor.operationTSType?.queryParams,
		"Record<string, never>",
	);
}

function querystringType(operation: OperationWrapper): string {
	return typeName(operation.accessor.operationTSType?.querystring, 'unknown');
}

function querystringDeclaration(operation: OperationWrapper): string {
	if (!operation.accessor.hasQuerystringParameter) return '';
	return `${querystringParameterName(operation)}${operation.accessor.isQuerystringRequired ? '' : '?'}: ${querystringType(operation)}`;
}

function bodyType(operation: OperationWrapper): string {
	return typeName(operation.accessor.operationTSType?.body, "unknown");
}

function queryParameterDeclaration(operation: OperationWrapper): string {
	if (!operation.accessor.hasQueryParameters) return "";
	return `${queryParameterName(operation)}${operation.accessor.isQueryParametersOptional ? "?" : ""}: ${queryType(operation)}`;
}

function legacyQueryArguments(operation: OperationWrapper): string[] {
	return [
		...pathParameters(operation),
		...(operation.accessor.hasRequestBody ? ["data"] : []),
		...(operation.accessor.hasQueryParameters
			? [queryParameterName(operation)]
			: []),
		...(operation.accessor.hasQuerystringParameter ? [querystringParameterName(operation)] : []),
	];
}

interface QueryInputParameter {
	name: string;
	declaration: string;
	optional: boolean;
}

function queryInputParameters(
	operation: OperationWrapper,
): QueryInputParameter[] {
	const parameters: QueryInputParameter[] = pathParameters(operation).map(
		(name) => ({
			name,
			declaration: `${name}: ${pathParameterType(operation, name)}`,
			optional: false,
		}),
	);
	if (operation.accessor.hasRequestBody) {
		const optional = !operation.accessor.isRequestBodyRequired;
		parameters.push({
			name: "data",
			declaration: `data${optional ? "?" : ""}: ${bodyType(operation)}`,
			optional,
		});
	}
	const query = queryParameterDeclaration(operation);
	if (query) {
		parameters.push({
			name: queryParameterName(operation),
			declaration: query,
			optional: operation.accessor.isQueryParametersOptional,
		});
	}
	const querystring = querystringDeclaration(operation);
	if (querystring) parameters.push({ name: querystringParameterName(operation), declaration: querystring, optional: !operation.accessor.isQuerystringRequired });
	return parameters.sort(
		(left, right) => Number(left.optional) - Number(right.optional),
	);
}

function queryKeyDeclaration(
	operation: OperationWrapper,
	targetIdentity: string,
): string {
	const declarations = operation.sourceMethod === "query"
		? queryInputParameters(operation).map(({ declaration }) => declaration)
		: [
				...pathParameters(operation).map(
					(name) => `${name}: ${pathParameterType(operation, name)}`,
				),
				...(operation.accessor.hasRequestBody
					? [`data: ${bodyType(operation)}`]
					: []),
				...(queryParameterDeclaration(operation)
					? [queryParameterDeclaration(operation)]
					: []),
				...(querystringDeclaration(operation) ? [querystringDeclaration(operation)] : []),
			];
	const pathIdentity =
		pathParameters(operation).length > 0
			? `{ ${pathParameters(operation)
					.map((name) => `${JSON.stringify(name)}: ${name}`)
					.join(", ")} }`
			: "{}";
	const methodIdentity =
		operation.sourceMethod === "query"
			? operation.wireMethod
			: operation.method;
	return `export const ${queryKeyName(operation)} = (${declarations.join(", ")}) => [{ target: ${JSON.stringify(targetIdentity)}, operation: ${JSON.stringify(operation.accessor.operationId)}, tag: ${JSON.stringify(operation.tagName)}, method: ${JSON.stringify(methodIdentity)}, route: ${JSON.stringify(operation.path)}, path: ${pathIdentity}, body: ${operation.accessor.hasRequestBody ? "data" : "undefined"}, query: ${operation.accessor.hasQueryParameters ? queryParameterName(operation) : "undefined"}${operation.accessor.hasQuerystringParameter ? `, querystring: ${querystringParameterName(operation)}` : ''} }] as const;\n\nexport type ${queryKeyTypeName(operation)} = ReturnType<typeof ${queryKeyName(operation)}>;`;
}

export function buildQuery(
	operation: OperationWrapper,
	config: ResolvedPluginConfig,
	targetIdentity: string,
): string {
	const response = typeName(
		operation.accessor.operationTSType?.responseSuccess,
		"unknown",
	);
	const responseError = typeName(
		operation.accessor.operationTSType?.responseError,
		"unknown",
	);
	const requestConfigType =
		config.requestConfigTypeImportDeclaration.namedImports[0] ?? "unknown";
	const headerType = operation.accessor.operationTSType?.headerParams;
	const cookieType = operation.accessor.operationTSType?.cookieParams;
	const hasHeaders = operation.accessor.hasHeaderParameters;
	const hasCookies = operation.accessor.hasCookieParameters;
	const requiredHeaders =
		hasHeaders && !operation.accessor.isHeaderParametersOptional;
	const requiredCookies =
		hasCookies && !operation.accessor.isCookieParametersOptional;
	const requiredRequestOptions = requiredHeaders || requiredCookies;
	const errorType =
		config.responseErrorTypeImportDeclaration.namedImports[0] ?? "Error";
	const key = queryKeyName(operation);
	const keyType = queryKeyTypeName(operation);
	const configType = queryConfigTypeName(operation);
	const options = queryOptionsName(operation);
	const hook = queryHookName(operation);
	const configParameter = queryConfigName(operation);
	const signalParameter = querySignalName(operation);
	const inputParameters = operation.sourceMethod === "query"
		? queryInputParameters(operation)
		: [];
	const args = operation.sourceMethod === "query"
		? inputParameters.map(({ name }) => name)
		: legacyQueryArguments(operation);
	const requestSignal =
		signalParameter === "signal" ? "signal" : `signal: ${signalParameter}`;
	const input = [
		pathParameters(operation).length
			? `path: { ${pathParameters(operation).join(", ")} }`
			: "",
		operation.accessor.hasRequestBody ? "body: data" : "",
		operation.accessor.hasQueryParameters
			? `query: ${queryParameterName(operation)}`
			: "",
		operation.accessor.hasQuerystringParameter ? `querystring: ${querystringParameterName(operation)}` : "",
		hasHeaders ? `headers: ${configParameter}?.headers` : "",
		hasCookies ? `cookies: ${configParameter}?.cookies` : "",
	].filter(Boolean);
	const callArguments = [
		`{ ${input.join(", ")} }`,
		`{ ...${configParameter}?.requestConfig, ${requestSignal} }`,
	];
	const callableParameters = operation.sourceMethod === "query"
		? [
				...inputParameters,
				{
					name: configParameter,
					declaration: `${configParameter}${requiredRequestOptions ? "" : "?"}: ${configType}<TData>`,
					optional: !requiredRequestOptions,
				},
			].sort((left, right) => Number(left.optional) - Number(right.optional))
		: [];
	const functionParameters = operation.sourceMethod === "query"
		? callableParameters.map(({ declaration }) => declaration)
		: [
				...pathParameters(operation).map(
					(name) => `${name}: ${pathParameterType(operation, name)}`,
				),
				...(operation.accessor.hasRequestBody
					? [`data: ${bodyType(operation)}`]
					: []),
				operation.accessor.hasQueryParameters
					? `${queryParameterName(operation)}${requiredRequestOptions ? "" : operation.accessor.isQueryParametersOptional ? "?" : ""}: ${queryType(operation)}${requiredRequestOptions && operation.accessor.isQueryParametersOptional ? " | undefined" : ""}`
					: "",
				operation.accessor.hasQuerystringParameter
					? `${querystringParameterName(operation)}${requiredRequestOptions ? "" : operation.accessor.isQuerystringRequired ? "" : "?"}: ${querystringType(operation)}${requiredRequestOptions && !operation.accessor.isQuerystringRequired ? " | undefined" : ""}`
					: "",
				`${configParameter}${requiredRequestOptions ? "" : "?"}: ${configType}<TData>`,
			].filter(Boolean);
	const optionsCallArguments = operation.sourceMethod === "query"
		? callableParameters.map(({ name }) => name)
		: [...args, configParameter];
	const queryCall = `${operation.accessor.operationRequest?.requestName}(${callArguments.join(", ")})`;
	const queryConfig = `export type ${configType}<TData = ${response}> = {\n${hasHeaders ? `  headers${requiredHeaders ? "" : "?"}: ${headerType};\n` : ""}${hasCookies ? `  cookies${requiredCookies ? "" : "?"}: ${cookieType};\n` : ""}  requestConfig?: Partial<${requestConfigType}>;\n  query?: Omit<UseQueryOptions<${response}, ${errorType}<${responseError}>, TData, ${keyType}>, 'queryKey' | 'queryFn'>;\n};`;
	const querySignalBinding =
		signalParameter === "signal" ? "signal" : `signal: ${signalParameter}`;
	const optionsFactory = `export const ${options} = <TData = ${response}>(${functionParameters.join(", ")}) => queryOptions<${response}, ${errorType}<${responseError}>, TData, ${keyType}>({\n  ...${configParameter}?.query,\n  queryKey: ${key}(${args.join(", ")}),\n  queryFn: ({ ${querySignalBinding} }) => ${queryCall},\n});`;
	const hookWrapper = config.hooks
		? `\n\nexport const ${hook} = <TData = ${response}>(${functionParameters.join(", ")}) => useQuery(${options}(${optionsCallArguments.join(", ")}));`
		: "";
	return `${queryKeyDeclaration(operation, targetIdentity)}\n\n${queryConfig}\n\n${optionsFactory}${hookWrapper}`;
}
