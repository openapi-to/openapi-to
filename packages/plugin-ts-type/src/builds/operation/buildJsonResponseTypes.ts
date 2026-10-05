import {
	describeOperationResponses,
	inspectOpenAPI32MediaContent,
	type OperationWrapper,
	operationSourcePath,
} from "@openapi-to/core";
import type { StatementStructures } from "ts-morph";
import {
	buildDefaultSuccessType,
	buildResponseErrorType,
	buildResponseUnionType,
	operationResponseTemplate,
	createTypeAlias,
} from "@/templates/operationResponseTemplate.ts";
import {
	getResponseStatusTypeName,
	getResponseSuccessName,
} from "@/templates/operationTypeNameTemplate.ts";
import type { JsonResponseObject } from "@/types.ts";
import type { InlineEnumSymbolResolver } from "@/utils/inlineEnumNaming.ts";

export function buildJsonResponseTypes(
	operation: OperationWrapper,
	inlineEnumSymbols?: InlineEnumSymbolResolver,
): StatementStructures[] {
	const responseName = getResponseSuccessName(operation);
	const sourcePath = operationSourcePath(operation);

	const descriptors = describeOperationResponses(operation.accessor.operation);
	const mediaByStatus = new Map(descriptors.map((descriptor) => [descriptor.sourceStatusCode,
		String(operation.accessor.operation.api?.openapi).startsWith("3.2.")
			? inspectOpenAPI32MediaContent(operation.accessor.operation.api, operation.accessor.operation.schema?.responses?.[descriptor.sourceStatusCode], [...sourcePath, "responses", descriptor.sourceStatusCode])
			: [],
	] as const));
	const unsupported = (status: string) => mediaByStatus.get(status)?.some((entry) => !entry.semantics || entry.semantics.hasItemSchema) ?? false;
	const responseObjects: JsonResponseObject[] = descriptors.map((descriptor) => ({
		code: descriptor.statusCode,
		jsonSchema: descriptor.kind === "no-content" ? undefined : {
			description: descriptor.description,
			label: descriptor.label ?? descriptor.statusCode,
			schema: unsupported(descriptor.sourceStatusCode) ? false :
				descriptor.kind === "reference" ? (descriptor.schema ?? true) :
				(mediaByStatus.get(descriptor.sourceStatusCode)?.find((entry) => entry.mediaType === descriptor.contentType)?.mediaObject?.schema as typeof descriptor.schema ?? descriptor.schema ?? true),
			type: descriptor.type ?? "object",
		},
	}));
	const namedResponses = responseObjects.map((response) => ({
		...response,
		name: getResponseStatusTypeName(responseName, response.code),
	}));
	const responseTypes = namedResponses.map(({ name, ...response }, index) =>
		unsupported(descriptors[index]?.sourceStatusCode ?? response.code)
			? createNeverResponse(name)
			: operationResponseTemplate(
			response,
			name,
			inlineEnumSymbols,
			response.jsonSchema
				? [
						...sourcePath,
						"responses",
						descriptors[index]?.sourceStatusCode ?? response.code,
						"content",
						descriptors[index]?.contentType ?? response.jsonSchema.label,
						"schema",
					]
				: undefined,
		),
	);

	responseTypes.push(
		buildResponseErrorType(
			operation.accessor.operationName,
			namedResponses
				.filter(({ code }) =>
					descriptors.some(
						(descriptor) =>
							descriptor.statusCode === code &&
							descriptor.classification === "error",
					),
				)
				.map(({ name }) => name),
		),
	);

	const successNames = namedResponses
		.filter(({ code }) =>
			descriptors.some(
				(descriptor) =>
					descriptor.statusCode === code &&
					descriptor.classification === "success",
			),
		)
		.map(({ name }) => name);
	if (successNames.length > 0) {
		responseTypes.push(buildResponseUnionType(responseName, successNames));
	} else {
		responseTypes.push(buildDefaultSuccessType(responseName));
	}

	return responseTypes;
}

function createNeverResponse(name: string): StatementStructures {
	return createTypeAlias(name, "never");
}
