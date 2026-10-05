import {
	describeOperationResponses,
	getOperationRequestBodyMediaType,
	inspectOpenAPI32MediaContent,
	operationSourcePath,
	type OperationWrapper,
} from "@openapi-to/core";
import {
	collectEnumsFromPathParameters,
	collectEnumsFromPathRequestBodies,
	collectEnumsFromPathResponses,
} from "@/collect/collectEnumsFromDocument.ts";
import {
	getRequestBodyTypeName,
	getResponseStatusTypeName,
	getResponseSuccessName,
} from "@/templates/operationTypeNameTemplate.ts";

export function collectEnumFormOperation(operation: OperationWrapper) {
	const responseTagEnums = [];
	const sourcePath = operationSourcePath(operation);

	const responseName = getResponseSuccessName(operation);
	const requestBody = operation.accessor.operation.schema?.requestBody;
	const selectedBody = getOperationRequestBodyMediaType(operation.accessor.operation);
	const bodyEntries = String(operation.accessor.operation.api?.openapi).startsWith("3.2.")
		? inspectOpenAPI32MediaContent(operation.accessor.operation.api, requestBody, [...sourcePath, "requestBody"])
		: [];
	const bodyEntry = bodyEntries.find((entry) => entry.mediaType === (selectedBody ? selectedBody[0] : undefined));
	const requestBodyEnums =
		bodyEntries.some((entry) => !entry.semantics || entry.semantics.hasItemSchema) || (requestBody && "$ref" in requestBody)
			? []
			: collectEnumsFromPathRequestBodies(
					bodyEntry?.mediaObject && selectedBody ? [selectedBody[0], bodyEntry.mediaObject as typeof selectedBody[1]] : selectedBody,
					getRequestBodyTypeName(operation.accessor.operationName),
					sourcePath,
				);
	for (const response of describeOperationResponses(
		operation.accessor.operation,
	)) {
		if (response.kind === "reference") continue;
		const responseEntries = String(operation.accessor.operation.api?.openapi).startsWith("3.2.")
			? inspectOpenAPI32MediaContent(operation.accessor.operation.api, operation.accessor.operation.schema?.responses?.[response.sourceStatusCode], [...sourcePath, "responses", response.sourceStatusCode])
			: [];
		if (responseEntries.some((entry) => !entry.semantics || entry.semantics.hasItemSchema)) continue;
		const responseSchema = responseEntries.find((entry) => entry.mediaType === response.contentType)?.mediaObject?.schema as typeof response.schema ?? response.schema;
		const responses =
			responseSchema === undefined
				? []
				: [
						{
							description: response.description,
							label: response.label ?? response.statusCode,
							schema: responseSchema,
							type: response.type ?? "object",
						},
					];
		const contentTypes = responseSchema
			? [response.contentType ?? response.statusCode]
			: [];

		const responseEnum = collectEnumsFromPathResponses(
			responses,
			getResponseStatusTypeName(responseName, response.statusCode),
			[...sourcePath, "responses", response.sourceStatusCode],
			contentTypes,
		);
		responseTagEnums.push(...responseEnum);
	}

	return [
		...collectEnumsFromPathParameters(
			operation.accessor.parameters,
			operation.accessor.operationName,
			sourcePath,
		),
		...requestBodyEnums,
		...responseTagEnums,
	];
}
