import type { OperationWrapper } from "@openapi-to/core";
import { camelCase } from "lodash-es";
import type { ResolvedPluginConfig } from "../types.ts";
import { requestContract } from "./requestContract.ts";
import {
	mutationBodyVariableName,
	mutationConfigName,
	mutationConfigTypeName,
	mutationHookName,
	mutationKeyName,
	mutationKeyTypeName,
	mutationOptionsName,
	mutationQueryVariableName,
	mutationQuerystringVariableName,
	variablesTypeName,
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

function variableProperties(operation: OperationWrapper): string[] {
	const properties = pathParameters(operation).map(
		(name) => `${name}: ${pathParameterType(operation, name)}`,
	);
	if (operation.accessor.hasRequestBody)
		properties.push(
			`${mutationBodyVariableName(operation)}: ${typeName(operation.accessor.operationTSType?.body, "unknown")}`,
		);
	if (operation.accessor.hasQueryParameters)
		properties.push(
			`${mutationQueryVariableName(operation)}${operation.accessor.isQueryParametersOptional ? "?" : ""}: ${queryType(operation)}`,
		);
	if (operation.accessor.hasQuerystringParameter)
		properties.push(`${mutationQuerystringVariableName(operation)}${operation.accessor.isQuerystringRequired ? "" : "?"}: ${typeName(operation.accessor.operationTSType?.querystring, "unknown")}`);
	return properties;
}

export function buildMutation(
	operation: OperationWrapper,
	config: ResolvedPluginConfig,
	targetIdentity: string,
): string {
	const response = typeName(
		operation.accessor.operationTSType?.responseSuccess,
		"unknown",
	);
	const responseType = operation.accessor.operationRequest?.transport === "fetch"
		? `Awaited<ReturnType<typeof ${operation.accessor.operationRequest.requestName}>>`
		: response;
	const responseError = typeName(
		operation.accessor.operationTSType?.responseError,
		"unknown",
	);
	const requestTypes = requestContract(operation, config);
	const requestConfigType = requestTypes.requestConfigType;
	const headerType = operation.accessor.operationTSType?.headerParams;
	const cookieType = operation.accessor.operationTSType?.cookieParams;
	const hasHeaders = operation.accessor.hasHeaderParameters;
	const hasCookies = operation.accessor.hasCookieParameters;
	const requiredHeaders =
		hasHeaders && !operation.accessor.isHeaderParametersOptional;
	const requiredCookies =
		hasCookies && !operation.accessor.isCookieParametersOptional;
	const requiredRequestOptions = requiredHeaders || requiredCookies;
	const errorType = requestTypes.responseErrorType;
	const key = mutationKeyName(operation);
	const keyType = mutationKeyTypeName(operation);
	const variables = variablesTypeName(operation);
	const configType = mutationConfigTypeName(operation);
	const options = mutationOptionsName(operation);
	const hook = mutationHookName(operation);
	const queryVariable = mutationQueryVariableName(operation);
	const configParameter = mutationConfigName(operation);
	const variableNames = [
		...pathParameters(operation),
		...(operation.accessor.hasRequestBody
			? [mutationBodyVariableName(operation)]
			: []),
		...(operation.accessor.hasQueryParameters ? [queryVariable] : []),
		...(operation.accessor.hasQuerystringParameter ? [mutationQuerystringVariableName(operation)] : []),
	];
	const input = [
		pathParameters(operation).length
			? `path: { ${pathParameters(operation).join(", ")} }`
			: "",
		operation.accessor.hasRequestBody
			? `body: ${mutationBodyVariableName(operation)}`
			: "",
		operation.accessor.hasQueryParameters ? `query: ${queryVariable}` : "",
		operation.accessor.hasQuerystringParameter ? `querystring: ${mutationQuerystringVariableName(operation)}` : "",
		hasHeaders ? `headers: ${configParameter}?.headers` : "",
		hasCookies ? `cookies: ${configParameter}?.cookies` : "",
	].filter(Boolean);
	const requestArguments = [
		`{ ${input.join(", ")} }`,
		`${configParameter}?.requestConfig`,
	];
	const properties = variableProperties(operation);
	const mutationConfig = `export type ${configType} = {\n${hasHeaders ? `  headers${requiredHeaders ? "" : "?"}: ${headerType};\n` : ""}${hasCookies ? `  cookies${requiredCookies ? "" : "?"}: ${cookieType};\n` : ""}  requestConfig?: Partial<${requestConfigType}>;\n  mutation?: Omit<UseMutationOptions<${responseType}, ${errorType}<${responseError}>, ${variables}>, 'mutationKey' | 'mutationFn'>;\n};`;
	const keyFactory = `export const ${key} = () => [{ target: ${JSON.stringify(targetIdentity)}, operation: ${JSON.stringify(operation.accessor.operationId)}, tag: ${JSON.stringify(operation.tagName)}, method: ${JSON.stringify(operation.method)}, route: ${JSON.stringify(operation.path)} }] as const;\n\nexport type ${keyType} = ReturnType<typeof ${key}>;`;
	const variablesType = `export type ${variables} = {\n${properties.map((property) => `  ${property};`).join("\n")}\n};`;
	const mutationVariables =
		properties.length > 0 ? `({ ${variableNames.join(", ")} })` : "()";
	const optionsFactory = `export const ${options} = (${configParameter}${requiredRequestOptions ? "" : "?"}: ${configType}) => mutationOptions({\n  ...${configParameter}?.mutation,\n  mutationKey: ${key}(),\n  mutationFn: ${mutationVariables} => ${operation.accessor.operationRequest?.requestName}(${requestArguments.join(", ")}),\n});`;
	const hookWrapper = config.hooks
		? `\n\nexport const ${hook} = (${configParameter}${requiredRequestOptions ? "" : "?"}: ${configType}) => useMutation(${options}(${configParameter}));`
		: "";
	return `${keyFactory}\n\n${variablesType}\n\n${mutationConfig}\n\n${optionsFactory}${hookWrapper}`;
}
