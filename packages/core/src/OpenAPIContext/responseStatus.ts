import type { Operation } from "oas/operation";
import { getParameterContentType } from "oas/utils";
import { resolveJSONPointer } from "../openapi/refResolver.ts";
import type { ComponentsResponsesValue, Schema } from "./types.ts";

export interface ClassifiedResponseStatusCodes {
	success: string[];
	error: string[];
}

export type ResponseSemanticKind =
	| "schema"
	| "unknown-media"
	| "no-content"
	| "reference";

export interface ResponseDescriptor {
	statusCode: string;
	sourceStatusCode: string;
	classification: "success" | "error";
	kind: ResponseSemanticKind;
	contentType?: string;
	schema?: Schema;
	description?: string;
	label?: string;
	type?: string;
	inspection?: ResponseInspection[];
	headers?: ResponseHeadersDescriptor;
}

export interface ResponseHeaderDescriptor {
	sourceName: string;
	canonicalName: string;
	required: boolean;
	schema: Schema;
	contentType?: string;
	sourceRef?: string;
	resolution: "inline" | "resolved" | "unresolved" | "cycle" | "external";
}

export interface ResponseHeadersDescriptor {
	headers: ResponseHeaderDescriptor[];
	collisions: Array<{ canonicalName: string; sourceNames: string[] }>;
}

export interface ResponseInspection {
	contentType?: string;
	description?: string;
	label?: string;
	schema?: Schema;
	type?: string;
}

export function selectResponseContentType(
	response: ComponentsResponsesValue,
): string | undefined {
	if ("$ref" in response || !response.content) return undefined;
	return getParameterContentType(Object.keys(response.content)) || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveResponseForInspection(
	operation: Operation,
	response: ComponentsResponsesValue,
): ComponentsResponsesValue | undefined {
	let current: unknown = response;
	const seenRefs = new Set<string>();
	while (isRecord(current) && typeof current.$ref === "string") {
		if (seenRefs.has(current.$ref)) return undefined;
		seenRefs.add(current.$ref);
		const resolved = resolveJSONPointer(operation.api, current.$ref);
		if (!resolved.found) return undefined;
		current = resolved.value;
	}
	return isRecord(current)
		? (current as ComponentsResponsesValue)
		: undefined;
}

function resolveLocalReference(
	document: unknown,
	value: unknown,
): { value?: Record<string, unknown>; resolution: ResponseHeaderDescriptor["resolution"] } {
	let current: unknown = value;
	const seenRefs = new Set<string>();
	while (isRecord(current) && typeof current.$ref === "string") {
		const ref = current.$ref;
		if (!ref.startsWith("#")) return { resolution: "external" };
		if (seenRefs.has(ref)) return { resolution: "cycle" };
		if (seenRefs.size >= 128) return { resolution: "unresolved" };
		seenRefs.add(ref);
		const resolved = resolveJSONPointer(document, ref);
		if (!resolved.found || !isRecord(resolved.value)) {
			return { resolution: "unresolved" };
		}
		current = resolved.value;
	}
	return isRecord(current)
		? { value: current, resolution: seenRefs.size > 0 ? "resolved" : "inline" }
		: { resolution: "unresolved" };
}

function asciiLower(value: string): string {
	return value.replace(/[A-Z]/g, (character) =>
		String.fromCharCode(character.charCodeAt(0) + 32),
	);
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Describes the schema-level meaning of a Response Object's headers.
 * Only local references are followed; source acquisition and external-reference
 * policy remain owned by the OpenAPI compiler.
 */
export function describeResponseHeaders(
	response: ComponentsResponsesValue | undefined,
	document: unknown,
): ResponseHeadersDescriptor {
	const resolvedResponse = resolveLocalReference(document, response);
	const responseObject = resolvedResponse.value;
	if (!responseObject || !isRecord(responseObject.headers)) {
		return { headers: [], collisions: [] };
	}

	const grouped = new Map<string, string[]>();
	const headers: ResponseHeaderDescriptor[] = [];
	for (const sourceName of Object.keys(responseObject.headers).sort(compareText)) {
		const canonicalName = asciiLower(sourceName);
		if (canonicalName === "content-type") continue;
		const sourceHeader = responseObject.headers[sourceName];
		const resolution = resolveLocalReference(document, sourceHeader);
		const headerObject = resolution.value;
		const refs = isRecord(sourceHeader) && typeof sourceHeader.$ref === "string"
			? [sourceHeader.$ref]
			: [];
		let schema: Schema = true;
		let contentType: string | undefined;
		if (headerObject) {
			if (headerObject.schema !== undefined) {
				schema = headerObject.schema as Schema;
			} else if (isRecord(headerObject.content)) {
				const mediaName = Object.keys(headerObject.content).sort(compareText)[0];
				if (mediaName !== undefined) {
					contentType = mediaName;
					const media = headerObject.content[mediaName];
					schema = isRecord(media) && media.schema !== undefined
						? media.schema as Schema
						: true;
				}
			}
		} else {
			schema = false;
		}
		const descriptor: ResponseHeaderDescriptor = {
			sourceName,
			canonicalName,
			required: headerObject?.required === true,
			schema,
			...(contentType === undefined ? {} : { contentType }),
			...(refs[0] === undefined ? {} : { sourceRef: refs[0] }),
			resolution: resolution.resolution,
		};
		headers.push(descriptor);
		const names = grouped.get(canonicalName) ?? [];
		names.push(sourceName);
		grouped.set(canonicalName, names);
	}

	const collisions = [...grouped.entries()]
		.filter(([, names]) => names.length > 1)
		.sort(([left], [right]) => compareText(left, right))
		.map(([canonicalName, sourceNames]) => ({
			canonicalName,
			sourceNames: sourceNames.sort(compareText),
		}));
	return { headers, collisions };
}

function inspectResponse(
	operation: Operation,
	statusCode: string,
	response: ComponentsResponsesValue | undefined,
): ResponseInspection[] {
	if (response) {
		const resolved = resolveResponseForInspection(operation, response);
		if (!resolved || "$ref" in resolved) return [];
		const content = resolved.content ?? {};
		const selectedContentType = selectResponseContentType(resolved);
		if (!selectedContentType) {
			return [{ description: resolved.description }];
		}
		const media = content[selectedContentType];
		return [{
			contentType: selectedContentType,
			description: resolved.description,
			label: selectedContentType,
			schema: media?.schema ?? true,
		}];
	}

	return (
		(operation.getResponseAsJSONSchema?.(statusCode) as
			| ResponseInspection[]
			| null
			| undefined) ?? []
	);
}

function compareStatus(left: string, right: string): number {
	const rank = (status: string) => {
		if (/^\d{3}$/.test(status)) return Number(status);
		const wildcard = /^([1-5])XX$/.exec(status);
		if (wildcard?.[1]) return Number(wildcard[1]) * 100 + 99;
		return Number.POSITIVE_INFINITY;
	};
	const leftNumber = rank(left);
	const rightNumber = rank(right);
	return leftNumber - rightNumber || left.localeCompare(right);
}

function canonicalizeStatus(status: string): string {
	if (/^[1-5]xx$/i.test(status)) return status.toUpperCase();
	if (/^default$/i.test(status)) return "default";
	return status;
}

/**
 * Deterministically classify documented responses.
 *
 * Informational 1xx/1XX responses are retained as non-success responses because
 * generated clients do not expose a separate informational-response channel.
 * `default` is a success fallback only when no 2xx response exists.
 */
export function classifyResponseStatusCodes(
	statusCodes: readonly string[],
): ClassifiedResponseStatusCodes {
	const unique = [
		...new Set(statusCodes.map((status) => canonicalizeStatus(String(status)))),
	];
	const concreteSuccess = unique
		.filter((code) => /^2\d{2}$/.test(code))
		.sort(compareStatus);
	const wildcardSuccess = unique
		.filter((code) => code === "2XX")
		.sort(compareStatus);
	const documentedSuccess = [...concreteSuccess, ...wildcardSuccess];
	const hasDefault = unique.includes("default");
	const success =
		documentedSuccess.length > 0
			? documentedSuccess
			: hasDefault
				? ["default"]
				: [];
	const error = unique
		.filter((code) => /^(?:[13-5]\d{2}|[13-5]XX)$/.test(code))
		.sort(compareStatus);
	if (hasDefault && documentedSuccess.length > 0) error.push("default");
	return { success, error };
}

export function selectSuccessResponseStatusCode(
	statusCodes: readonly string[],
): string | undefined {
	return classifyResponseStatusCodes(statusCodes).success[0];
}

export function describeResponse(
	response: ComponentsResponsesValue | undefined,
	converted?: ResponseInspection,
): Pick<
	ResponseDescriptor,
	"kind" | "contentType" | "schema" | "description" | "label" | "type"
> {
	if (response && "$ref" in response && response.$ref) {
		return {
			kind: "reference",
			contentType: converted?.contentType,
			schema: { $ref: response.$ref },
			description: converted?.description,
			label: converted?.label,
			type: converted?.type,
		};
	}

	if (response && !("$ref" in response)) {
		const description = response.description || converted?.description;
		const contentType =
			converted?.contentType ?? selectResponseContentType(response);
		const media = contentType ? response.content?.[contentType] : undefined;
		if (media) {
			if (media.schema === undefined) {
				return {
					kind: "unknown-media",
					contentType,
					schema: true,
					description,
					label: converted?.label,
					type: converted?.type,
				};
			}
			return {
				kind: "schema",
				contentType,
				schema: media.schema,
				description,
				label: converted?.label,
				type: converted?.type,
			};
		}
		return {
			kind: "no-content",
			description,
			label: converted?.label,
			type: converted?.type,
		};
	}

	if (converted?.schema !== undefined) {
		return {
			kind: "schema",
			contentType: converted.contentType,
			schema: converted.schema,
			description: converted.description,
			label: converted.label,
			type: converted.type,
		};
	}

	return {
		kind: "no-content",
		description: converted?.description,
		label: converted?.label,
		type: converted?.type,
	};
}

export function describeOperationResponses(
	operation: Operation,
): ResponseDescriptor[] {
	const documentedStatusCodes = Object.keys(operation.schema?.responses ?? {});
	const sourceStatusCodes =
		documentedStatusCodes.length > 0
			? documentedStatusCodes
			: (operation.getResponseStatusCodes?.() ?? []);
	const { success, error } = classifyResponseStatusCodes(sourceStatusCodes);

	return [...success, ...error].map((statusCode) => {
		const sourceStatusCode =
			sourceStatusCodes.find(
				(status) => String(status).toLowerCase() === statusCode.toLowerCase(),
			) ?? statusCode;
		const response = operation.schema?.responses?.[sourceStatusCode] as
			| ComponentsResponsesValue
			| undefined;
		const inspection = inspectResponse(
			operation,
			sourceStatusCode,
			response,
		);
		return {
			statusCode,
			sourceStatusCode,
			classification: success.includes(statusCode) ? "success" : "error",
			...describeResponse(response, inspection[0]),
			headers: describeResponseHeaders(response, operation.api),
			inspection,
		};
	});
}
