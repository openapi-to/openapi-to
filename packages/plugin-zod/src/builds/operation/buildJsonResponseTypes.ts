import {
	describeOperationResponses,
	type OperationWrapper,
} from "@openapi-to/core";
import type { StatementStructures } from "ts-morph";
import {
	buildResponseUnionSchema,
	operationResponseTemplate,
} from "@/templates/operationResponseTemplate.ts";
import {
	getResponseErrorTypeName,
	getResponseStatusSchemaName,
	getResponseSuccessName,
} from "@/templates/operationTypeNameTemplate.ts";
import { responseHeadersTemplate } from "@/templates/responseHeadersTemplate.ts";
import type { SchemaRenderOptions } from "@/templates/schemaTemplate.ts";
import type { JsonResponseObject } from "@/types.ts";

export function buildJsonResponseTypes(
	operation: OperationWrapper,
	options: SchemaRenderOptions = {},
): StatementStructures[] {
	const responseName = getResponseSuccessName(operation);

	const descriptors = describeOperationResponses(operation.accessor.operation);
	const responseObjects: JsonResponseObject[] = descriptors.map(
		(descriptor) => ({
			code: descriptor.statusCode,
			jsonSchema:
				descriptor.kind === "no-content"
					? undefined
					: {
							description: descriptor.description,
							label: descriptor.label ?? descriptor.statusCode,
							schema:
								(descriptor.inspection?.length ?? 0) > 1
									? false
									: (descriptor.schema ?? true),
							type: descriptor.type ?? "object",
						},
		}),
	);

	const namedResponses = responseObjects.map((response) => ({
		...response,
		name: getResponseStatusSchemaName(responseName, response.code),
	}));
	const responseTypes = namedResponses.map(({ name, ...response }) =>
		operationResponseTemplate(response, name, options),
	);
	for (const descriptor of descriptors) {
		if (descriptor.headers?.headers.length) {
			responseTypes.push(
				responseHeadersTemplate(
					descriptor.headers,
					`${getResponseStatusSchemaName(responseName, descriptor.statusCode)}Headers`,
					options,
				),
			);
		}
	}

	const successResponses = descriptors.filter(
		(descriptor) => descriptor.classification === "success",
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
	responseTypes.push(
		buildResponseUnionSchema(
			responseName,
			successNames,
			successResponses.some(
				(descriptor) => (descriptor.inspection?.length ?? 0) > 1,
			),
		),
	);

	const errorNames = namedResponses
		.filter(({ code }) =>
			descriptors.some(
				(descriptor) =>
					descriptor.statusCode === code &&
					descriptor.classification === "error",
			),
		)
		.map(({ name }) => name);
	if (errorNames.length > 0) {
		const errorResponses = descriptors.filter(
			(descriptor) => descriptor.classification === "error",
		);
		responseTypes.push(
			buildResponseUnionSchema(
				getResponseErrorTypeName(operation.accessor.operationName),
				errorNames,
				errorResponses.some(
					(descriptor) => (descriptor.inspection?.length ?? 0) > 1,
				),
			),
		);
	}

	return responseTypes;
}

// ---------------- Helper: 单个 Response 类型生成 ----------------
