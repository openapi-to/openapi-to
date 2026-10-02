import { operationSourcePath, type OperationWrapper } from "@openapi-to/core";
import { createTypeAlias } from "@/templates/operationResponseTemplate.ts";
import { getCookieParamsTypeName } from "@/templates/operationTypeNameTemplate.ts";
import { generateParameterType } from "@/utils/generatePropertyType.ts";
import type { InlineEnumSymbolResolver } from "@/utils/inlineEnumNaming.ts";

export function buildCookieParamsTypes(
	operation: OperationWrapper,
	inlineEnumSymbols?: InlineEnumSymbolResolver,
) {
	const parameters = operation.accessor.cookieParameters;
	if (parameters.length === 0) return;
	return createTypeAlias(
		getCookieParamsTypeName(operation.accessor.operationName),
		inlineEnumSymbols
			? generateParameterType(
					parameters,
					operation.accessor.operationName,
					inlineEnumSymbols,
					operationSourcePath(operation),
				)
			: generateParameterType(parameters, operation.accessor.operationName),
		[],
	);
}
