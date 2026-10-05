import {
	type ComponentsParameters,
	type ComponentsResponsesValue,
	describeOperationResponses,
	describeResponse,
	getOperationRequestBodyMediaTypeObject,
	inspectOpenAPI32MediaContent,
	type ParameterObjectWithRef,
	resolveParameterSchema,
} from "@openapi-to/core";
import type { Operation } from "oas/operation";
import type { OpenAPIV3, OpenAPIV3_1 } from "openapi-types";
import { collectRefsFromSchema } from "@/collect/collectRefsFromSchemas.ts";

type Reference = OpenAPIV3.ReferenceObject;

export function collectRefsFromOperationParameter(
	parameters: ParameterObjectWithRef[],
) {
	const refs: Set<string> = new Set();
	parameters.forEach((parameter) => {
		if ("$ref" in parameter && parameter.$ref) {
			refs.add(parameter.$ref);
		}

		const schema = resolveParameterSchema(parameter);
		if (schema !== undefined)
			collectRefsFromSchema(schema).forEach((ref) => {
				refs.add(ref);
			});
	});
	return [...refs];
}

export function collectRefsFromOperationRequestBody(oasOperation: Operation) {
	const refs: Set<string> = new Set();
	const requestBody = oasOperation.schema.requestBody;
	if (requestBody && "$ref" in requestBody && requestBody.$ref) {
		return [requestBody.$ref];
	}
	if (String(oasOperation.api?.openapi).startsWith("3.2.")) {
		const entries = inspectOpenAPI32MediaContent(
			oasOperation.api,
			requestBody,
			[],
		);
		if (
			entries.some((entry) => !entry.semantics || entry.semantics.hasItemSchema)
		)
			return [];
		for (const entry of entries)
			if (entry.mediaObject?.schema !== undefined)
				collectRefsFromSchema(
					entry.mediaObject.schema as Parameters<
						typeof collectRefsFromSchema
					>[0],
				).forEach((ref) => {
					refs.add(ref);
				});
		return [...refs];
	}
	//
	const mediaTypeObject = getOperationRequestBodyMediaTypeObject(oasOperation);

	if (mediaTypeObject) {
		if (mediaTypeObject.schema) {
			collectRefsFromSchema(mediaTypeObject.schema).forEach((ref) => {
				refs.add(ref);
			});
		}
	}
	return [...refs];
}

export function collectRefsFromOperationResponse(oasOperation: Operation) {
	const refs: Set<string> = new Set();
	for (const response of describeOperationResponses(oasOperation)) {
		if (
			String(oasOperation.api?.openapi).startsWith("3.2.") &&
			response.kind !== "reference"
		) {
			const entries = inspectOpenAPI32MediaContent(
				oasOperation.api,
				oasOperation.schema?.responses?.[response.sourceStatusCode],
				[],
			);
			if (
				entries.some(
					(entry) => !entry.semantics || entry.semantics.hasItemSchema,
				)
			)
				continue;
			for (const entry of entries)
				if (entry.mediaObject?.schema !== undefined)
					collectRefsFromSchema(
						entry.mediaObject.schema as Parameters<
							typeof collectRefsFromSchema
						>[0],
					).forEach((ref) => {
						refs.add(ref);
					});
			if (entries.length > 0) continue;
		}
		if (response.schema !== undefined) {
			collectRefsFromSchema(response.schema).forEach((ref) => {
				refs.add(ref);
			});
		}
	}
	return [...refs];
}

export function collectRefsFromComponentParameters(
	parameters: ComponentsParameters,
): string[] {
	const refs: Set<string> = new Set();

	for (const parameter of Object.values(parameters)) {
		if ("$ref" in parameter) {
			refs.add(parameter.$ref);
		} else {
			const schema = resolveParameterSchema(parameter);
			const $refs = schema === undefined ? [] : collectRefsFromSchema(schema);
			$refs.forEach((ref) => {
				refs.add(ref);
			});
		}
	}

	return [...refs];
}

export function collectRefsFromComponentRequestBody(
	rb: OpenAPIV3.RequestBodyObject | OpenAPIV3_1.RequestBodyObject | Reference,
	document?: unknown,
): string[] {
	const refs: Set<string> = new Set();

	if ("$ref" in rb) {
		refs.add(rb.$ref);
	} else if (document) {
		const entries = inspectOpenAPI32MediaContent(document, rb, []);
		if (
			entries.some((entry) => !entry.semantics || entry.semantics.hasItemSchema)
		)
			return [];
		for (const entry of entries)
			if (entry.mediaObject?.schema !== undefined)
				collectRefsFromSchema(
					entry.mediaObject.schema as Parameters<
						typeof collectRefsFromSchema
					>[0],
				).forEach((ref) => {
					refs.add(ref);
				});
	} else {
		for (const media of Object.values(rb.content || {})) {
			if (media?.schema) {
				collectRefsFromSchema(media.schema).forEach((ref) => {
					refs.add(ref);
				});
			}
		}
	}

	return [...refs];
}

export function collectRefsFromComponentResponse(
	response: ComponentsResponsesValue,
	document?: unknown,
) {
	const refs: Set<string> = new Set();

	// 处理直接是引用的情况
	if (response && "$ref" in response && response.$ref) {
		refs.add(response.$ref);
		return [...refs];
	}

	if (document) {
		const entries = inspectOpenAPI32MediaContent(document, response, []);
		if (
			entries.some((entry) => !entry.semantics || entry.semantics.hasItemSchema)
		)
			return [];
		for (const entry of entries)
			if (entry.mediaObject?.schema !== undefined)
				collectRefsFromSchema(
					entry.mediaObject.schema as Parameters<
						typeof collectRefsFromSchema
					>[0],
				).forEach((ref) => {
					refs.add(ref);
				});
		if (entries.length > 0) return [...refs];
	}
	const schema = describeResponse(response).schema;
	if (schema !== undefined)
		collectRefsFromSchema(schema).forEach((ref) => {
			refs.add(ref);
		});

	return [...refs];
}

//    const refType = `Component${upperFirst(getRefAlias(response.$ref))}ResponseModel`
//     refRegistry.add(refType)
