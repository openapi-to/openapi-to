import type { OperationWrapper } from "@openapi-to/core";
import { camelCase } from "lodash-es";
import { OpenAPIV3 } from "openapi-types";
import type { OptionalKind, ParameterDeclarationStructure } from "ts-morph";
import type { PluginConfig } from "../types.ts";
import { formatterQueryKeyTypeName } from "../utils/formatterQueryKey.ts";
import { buildResponseTypes } from "./buildResponseTypes.ts";

export function buildMethodParameters(
	operation: OperationWrapper,
	pluginConfig?: PluginConfig,
): OptionalKind<ParameterDeclarationStructure>[] {
	const hasHeaders = operation.accessor.hasHeaderParameters;
	const requiredHeaders =
		hasHeaders && !operation.accessor.isHeaderParametersOptional;
	const headerType = operation.accessor.operationTSType?.headerParams;
	const { data: responseConfigType, error: responseErrorType } =
		buildResponseTypes(operation, pluginConfig);
	const queryParameters: OptionalKind<ParameterDeclarationStructure> = {
		name: "params",
		hasQuestionToken:
			operation.accessor.isQueryParametersOptional && !requiredHeaders,
		type: `${operation.accessor.operationTSType?.queryParams}${requiredHeaders && operation.accessor.isQueryParametersOptional ? " | undefined" : ""}`,
	};

	const pathParameters: OptionalKind<ParameterDeclarationStructure>[] =
		operation.accessor.pathParameters.map((item) => {
			return {
				name: camelCase(item.name),
				type: `${operation.accessor.operationTSType?.pathParams || ""}['${camelCase(item.name)}']`,
			};
		});

	const options: OptionalKind<ParameterDeclarationStructure> = {
		name: requiredHeaders ? "options" : "options?",
		type: `{
    ${hasHeaders ? `headers${requiredHeaders ? "" : "?"}: ${headerType}\n    ` : ""}requestConfig?: Parameters<typeof ${operation.accessor.operationRequest?.requestName}>[1]
    query?: SWRConfiguration<${responseConfigType}, ${responseErrorType}, Fetcher<${responseConfigType}, ${formatterQueryKeyTypeName(operation)}>>
    shouldFetch?: boolean
    }`,
	};

	const mutationOptions: OptionalKind<ParameterDeclarationStructure> = {
		name: requiredHeaders ? "options" : "options?",
		type: `{
        ${hasHeaders ? `headers${requiredHeaders ? "" : "?"}: ${headerType}\n        ` : ""}requestConfig?: Parameters<typeof ${operation.accessor.operationRequest?.requestName}>[1]
        mutation?: SWRMutationConfiguration<${responseConfigType},  ${responseErrorType}, ${formatterQueryKeyTypeName(operation)} | null ${operation.accessor.operationTSType?.body ? `,${operation.accessor.operationTSType?.body}` : ",never"}>;
        shouldFetch?: boolean;
        }`,
	};

	const infiniteOptions: OptionalKind<ParameterDeclarationStructure> = {
		name: requiredHeaders ? "options" : "options?",
		type: `{
      ${hasHeaders ? `headers${requiredHeaders ? "" : "?"}: ${headerType}\n      ` : ""}requestConfig?: Parameters<typeof ${operation.accessor.operationRequest?.requestName}>[1]
      query?: Parameters<typeof useSWRInfinite<${responseConfigType},${responseErrorType}, ${formatterQueryKeyTypeName(operation)} | null>>[2]
      shouldFetch?: boolean
    }`,
	};

	return [
		...(operation.accessor.hasPathParameters ? pathParameters : []),
		...(operation.accessor.hasQueryParameters ? [queryParameters] : []),
		...(operation.method !== OpenAPIV3.HttpMethods.GET
			? [mutationOptions]
			: operation.accessor.queryParameters.some(
						(x) => x.name === pluginConfig?.infinite?.pageNumParam,
					)
				? [infiniteOptions]
				: [options]),
	];
}
