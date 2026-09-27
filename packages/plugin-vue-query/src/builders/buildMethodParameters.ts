import type { OperationWrapper } from "@openapi-to/core";
import { camelCase } from "lodash-es";
import { OpenAPIV3 } from "openapi-types";
import type { OptionalKind, ParameterDeclarationStructure } from "ts-morph";
import type { RequiredPluginConfig } from "../types.ts";
import { formatterQueryKeyTypeName } from "../utils/formatterQueryKey.ts";

export function buildMethodParameters(
	operation: OperationWrapper,
	pluginConfig: RequiredPluginConfig,
): OptionalKind<ParameterDeclarationStructure>[] {
	const requestConfigType =
		pluginConfig.requestConfigTypeImportDeclaration.namedImports[0];
	const hasHeaders = operation.accessor.hasHeaderParameters;
	const requiredHeaders =
		hasHeaders && !operation.accessor.isHeaderParametersOptional;
	const headerType = operation.accessor.operationTSType?.headerParams;

	const queryParameters: OptionalKind<ParameterDeclarationStructure> = {
		name: "params",
		hasQuestionToken:
			operation.accessor.isQueryParametersOptional && !requiredHeaders,
		type: `MaybeRefOrGetter<${operation.accessor.operationTSType?.queryParams}>${requiredHeaders && operation.accessor.isQueryParametersOptional ? " | undefined" : ""}`,
	};

	const pathParameters: OptionalKind<ParameterDeclarationStructure>[] =
		operation.accessor.pathParameters.map((item) => {
			return {
				name: camelCase(item.name),
				type: `MaybeRefOrGetter<${operation.accessor.operationTSType?.pathParams || ""}['${camelCase(item.name)}']>`,
			};
		});

	const options: OptionalKind<ParameterDeclarationStructure> = {
		name: requiredHeaders ? "options" : "options?",
		type: `{
    ${hasHeaders ? `headers${requiredHeaders ? "" : "?"}: MaybeRefOrGetter<${headerType}>\n    ` : ""}requestConfig?: Partial<${requestConfigType}>
    query?: Partial<UseQueryOptions<
    TQueryFnData,
    ${pluginConfig?.responseErrorTypeImportDeclaration?.namedImports[0]}<${operation.accessor.operationTSType?.responseError}>,
    TData,
    TQueryData,
    ${formatterQueryKeyTypeName(operation)}
    >>
    }`,
	};

	const mutationOptions: OptionalKind<ParameterDeclarationStructure> = {
		name: requiredHeaders ? "options" : "options?",
		type: `{
        ${hasHeaders ? `headers${requiredHeaders ? "" : "?"}: MaybeRefOrGetter<${headerType}>\n        ` : ""}requestConfig?: Partial<${requestConfigType}<${operation.accessor.operationTSType?.body || "never"}>>
        mutation?: UseMutationOptions<
        TData,  
        ${pluginConfig?.responseErrorTypeImportDeclaration?.namedImports[0]}<${operation.accessor.operationTSType?.responseError}>, 
        TVariables,
        TContext
 >;
        }`,
	};

	//GET method
	if (operation.method === OpenAPIV3.HttpMethods.GET) {
		return [
			...(operation.accessor.hasPathParameters ? pathParameters : []),
			...(operation.accessor.hasQueryParameters ? [queryParameters] : []),
			...(operation.accessor.queryParameters.some(
				(x) => x.name === pluginConfig?.infinite?.pageNumParam,
			)
				? []
				: [options]),
		];
	}

	// not GET method

	return [
		...(operation.accessor.hasQueryParameters ? [queryParameters] : []),
		mutationOptions,
	];
}
