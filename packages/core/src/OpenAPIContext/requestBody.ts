import type { Operation } from "oas/operation";
import { getParameterContentType } from "oas/utils";
import { resolveJSONPointer } from "../openapi/refResolver.ts";
import type { MediaTypeObject } from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveRequestBody(operation: Operation): Record<string, unknown> | false {
	let requestBody: unknown = operation.schema?.requestBody;
	const seenRefs = new Set<string>();
	while (isRecord(requestBody) && typeof requestBody.$ref === "string") {
		if (seenRefs.has(requestBody.$ref)) return false;
		seenRefs.add(requestBody.$ref);
		const resolved = resolveJSONPointer(operation.api, requestBody.$ref);
		if (!resolved.found) return false;
		requestBody = resolved.value;
	}
	return isRecord(requestBody) ? requestBody : false;
}

export function isOperationRequestBodyRequired(operation: Operation): boolean {
	const requestBody = resolveRequestBody(operation);
	return requestBody !== false && requestBody.required === true;
}

export function getOperationRequestBodyMediaType(
	operation: Operation,
): [string, MediaTypeObject] | false {
	const requestBody = resolveRequestBody(operation);
	if (!requestBody || !isRecord(requestBody.content)) return false;
	const contentTypes = Object.keys(requestBody.content);
	const selectedContentType = getParameterContentType(contentTypes);
	if (!selectedContentType) return false;
	const mediaTypeObject = requestBody.content[selectedContentType];
	return isRecord(mediaTypeObject)
		? [selectedContentType, mediaTypeObject as MediaTypeObject]
		: false;
}

export function getOperationRequestBodyMediaTypeObject(
	operation: Operation,
): MediaTypeObject | false {
	const selected = getOperationRequestBodyMediaType(operation);
	return selected ? selected[1] : false;
}
