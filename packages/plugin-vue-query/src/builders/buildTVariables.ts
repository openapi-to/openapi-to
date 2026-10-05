import type { OperationWrapper } from "@openapi-to/core";
import {
	type InterfaceDeclarationStructure,
	StructureKind,
	type TypeAliasDeclarationStructure,
} from "ts-morph";
import { getPathParameters } from "../utils/getPathParameters.ts";

export function buildTVariables(
	operation: OperationWrapper,
): (TypeAliasDeclarationStructure | InterfaceDeclarationStructure)[] {
	const responseType = operation.accessor.operationRequest?.transport === "fetch"
		? `Awaited<ReturnType<typeof ${operation.accessor.operationRequest.requestName}>>`
		: operation.accessor.operationTSType?.responseSuccess || "";
	return [
		{
			leadingTrivia: "\n",
			kind: StructureKind.TypeAlias,
			name: "TData",
			docs: [
				"the final transformed data type after `select` (or other transforms); this is what components receive.",
			],
			type: responseType,
		},
		{
			kind: StructureKind.Interface,
			name: "TVariables",
			isExported: false,
			properties: [
				...getPathParameters(operation).map((item) => {
					return {
						name: item.name,
						type: item.type,
						docs: [{ description: `Path parameter: ${item.name}` }],
					};
				}),
				operation.accessor.operationTSType?.body
					? {
							name: "data",
							type: `MaybeRefOrGetter<${operation.accessor.operationTSType?.body}>`,
							docs: [
								{ description: "The data to be sent in the request body." },
							],
						}
					: null,
				operation.accessor.hasQuerystringParameter
					? {
						name: 'querystring',
						hasQuestionToken: !operation.accessor.isQuerystringRequired,
						type: `MaybeRefOrGetter<${operation.accessor.operationTSType?.querystring}>`,
					}
					: null,
			].filter(Boolean),
		},
	];
}
