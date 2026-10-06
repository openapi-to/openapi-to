import type { OperationFakerResponse, OperationWrapper } from "@openapi-to/core";

import type { OptionalKind, ParameterDeclarationStructure } from "ts-morph";
import type { PluginConfig } from "../types.ts";

export function buildMethodParameters(
	operation: OperationWrapper,
	pluginConfig?: PluginConfig,
	fakerResponse?: OperationFakerResponse,
): OptionalKind<ParameterDeclarationStructure>[] {
	const isFakerMode = pluginConfig?.responseDefaultType === "faker";
	const dataParameters: OptionalKind<ParameterDeclarationStructure> = {
		name: "data",
		hasQuestionToken: isFakerMode
			? false
			: operation.accessor.isQueryParametersOptional,
		type: operation.accessor.operationTSType?.responseSuccess,
		initializer:
			isFakerMode && fakerResponse
				? `${fakerResponse.factoryName}(faker)`
				: "",
	};

	if (!isFakerMode || !fakerResponse) return [dataParameters];

	return [
		{
			name: "faker",
			type: `Parameters<typeof ${fakerResponse.factoryName}>[0]`,
		},
		dataParameters,
	];
}
