import type {
	ComponentsParameters,
	ComponentsResponsesValue,
	ParameterObjectWithRef,
} from "@openapi-to/core";
import {
	describeOperationResponses,
	describeResponse,
	describeResponseHeaders,
	getOperationRequestBodyMediaTypeObject,
	getOperationRequestBodyMediaTypes,
	resolveParameterSchema,
} from "@openapi-to/core";
import type { Operation } from "oas/operation";
import type { OpenAPIV3, OpenAPIV3_1 } from "openapi-types";
import {
	type CollectRefsFromSchemaOptions,
	collectRefsFromSchema,
} from "@/collect/collectRefsFromSchemas.ts";

type Reference = OpenAPIV3.ReferenceObject;

function hasMultipleContentEntries(value: unknown): boolean {
	return (
		typeof value === "object" &&
		value !== null &&
		"content" in value &&
		typeof value.content === "object" &&
		value.content !== null &&
		Object.keys(value.content).length > 1
	);
}

export function collectRefsFromOperationParameter(
	parameters: ParameterObjectWithRef[],
	options: CollectRefsFromSchemaOptions = {},
) {
	const refs: Set<string> = new Set();
	parameters.forEach((parameter) => {
		if ("$ref" in parameter && parameter.$ref) {
			refs.add(parameter.$ref);
		}
		const schema = hasMultipleContentEntries(parameter)
			? undefined
			: resolveParameterSchema(parameter);
		if (schema !== undefined) {
			collectRefsFromSchema(schema, options).forEach((ref) => {
				refs.add(ref);
			});
		}
	});
	return [...refs];
}

export function collectRefsFromOperationRequestBody(
	oasOperation: Operation,
	options: CollectRefsFromSchemaOptions = {},
) {
	const refs: Set<string> = new Set();
	const requestBody = oasOperation.schema.requestBody;
	if (requestBody && "$ref" in requestBody && requestBody.$ref) {
		return [requestBody.$ref];
	}
	if (getOperationRequestBodyMediaTypes(oasOperation).length > 1) return [];
	//
	const mediaTypeObject = getOperationRequestBodyMediaTypeObject(oasOperation);

	if (mediaTypeObject) {
		if (mediaTypeObject.schema) {
			collectRefsFromSchema(mediaTypeObject.schema, options).forEach((ref) => {
				refs.add(ref);
			});
		}
	}
	return [...refs];
}

export function collectRefsFromOperationResponse(
	oasOperation: Operation,
	options: CollectRefsFromSchemaOptions = {},
) {
	const refs: Set<string> = new Set();
	for (const response of describeOperationResponses(oasOperation)) {
		if (
			(response.inspection?.length ?? 0) <= 1 &&
			response.schema !== undefined
		) {
			collectRefsFromSchema(response.schema, options).forEach((ref) => {
				refs.add(ref);
			});
		}
		for (const header of response.headers?.headers ?? []) {
			collectRefsFromSchema(header.schema, options).forEach((ref) => {
				refs.add(ref);
			});
		}
	}
	return [...refs];
}

export function collectRefsFromComponentParameters(
	parameters: ComponentsParameters,
	options: CollectRefsFromSchemaOptions = {},
): string[] {
	const refs: Set<string> = new Set();

	for (const parameter of Object.values(parameters)) {
		if ("$ref" in parameter) {
			refs.add(parameter.$ref);
		} else {
			const schema = hasMultipleContentEntries(parameter)
				? undefined
				: resolveParameterSchema(parameter);
			const $refs =
				schema === undefined ? [] : collectRefsFromSchema(schema, options);
			$refs.forEach((ref) => {
				refs.add(ref);
			});
		}
	}

	return [...refs];
}

export function collectRefsFromComponentRequestBody(
	rb: OpenAPIV3.RequestBodyObject | OpenAPIV3_1.RequestBodyObject | Reference,
	options: CollectRefsFromSchemaOptions = {},
): string[] {
	const refs: Set<string> = new Set();

	if ("$ref" in rb) {
		refs.add(rb.$ref);
	} else {
		for (const media of Object.keys(rb.content ?? {}).length > 1
			? []
			: Object.values(rb.content || {})) {
			if (media?.schema) {
				collectRefsFromSchema(media.schema, options).forEach((ref) => {
					refs.add(ref);
				});
			}
		}
	}

	return [...refs];
}

export function collectRefsFromComponentResponse(
	response: ComponentsResponsesValue,
	document: unknown,
	options: CollectRefsFromSchemaOptions = {},
) {
	const refs: Set<string> = new Set();

	// 处理直接是引用的情况
	if (response && "$ref" in response && response.$ref) {
		refs.add(response.$ref);
	} else {
		if (!hasMultipleContentEntries(response)) {
			const schema = describeResponse(response).schema;
			if (schema !== undefined)
				collectRefsFromSchema(schema, options).forEach((ref) => {
					refs.add(ref);
				});
		}
	}
	for (const header of describeResponseHeaders(response, document).headers) {
		collectRefsFromSchema(header.schema, options).forEach((ref) => {
			refs.add(ref);
		});
	}

	return [...refs];
}

//    const refType = `Component${upperFirst(getRefAlias(response.$ref))}ResponseModel`
//     refRegistry.add(refType)
