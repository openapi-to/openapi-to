import type { Operation } from "oas/operation";
import { effectiveParameters } from "./effectiveParameters.ts";
import {
	classifyOpenAPI32EncodingContentTypes,
	classifyOpenAPI32MediaType,
	type OpenAPI32MediaTypeSemantics,
} from "./mediaTypeSemantics.ts";
import { resolveJSONPointer } from "./refResolver.ts";

export interface OpenAPI32MediaEntry {
	positionalArray: boolean;
	formDataArrayProperty: boolean;
	schemaReferenceUnresolved: boolean;
	nestedMultipart: boolean;
	mediaType: string;
	path: Array<string | number>;
	semantics?: OpenAPI32MediaTypeSemantics;
	mediaObject?: Record<string, unknown>;
	resolution: "inline" | "resolved" | "unresolved";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Resolve only local object references already present in the plugin document. */
function resolveObject(
	document: unknown,
	value: unknown,
): { value?: Record<string, unknown>; resolved: boolean } {
	let current: unknown = value;
	const seen = new Set<string>();
	while (isRecord(current) && typeof current.$ref === "string") {
		const ref = current.$ref;
		if (!ref.startsWith("#") || seen.has(ref) || seen.size >= 128)
			return { resolved: false };
		seen.add(ref);
		const result = resolveJSONPointer(document, ref);
		if (!result.found || !isRecord(result.value)) return { resolved: false };
		current = result.value;
	}
	return isRecord(current)
		? { value: current, resolved: seen.size > 0 }
		: { resolved: false };
}

function schemaShape(
	document: unknown,
	schema: unknown,
	checkFormDataProperties: boolean,
): {
	positionalArray: boolean;
	formDataArrayProperty: boolean;
	schemaReferenceUnresolved: boolean;
} {
	const scan = (
		value: unknown,
		depth: number,
		refs: Set<string>,
		objects: Set<object>,
	): {
		positionalArray: boolean;
		formDataArrayProperty: boolean;
		schemaReferenceUnresolved: boolean;
	} => {
		if (!isRecord(value))
			return {
				positionalArray: false,
				formDataArrayProperty: false,
				schemaReferenceUnresolved: false,
			};
		if (depth >= 64 || objects.has(value))
			return {
				positionalArray: false,
				formDataArrayProperty: false,
				schemaReferenceUnresolved: true,
			};
		const nextObjects = new Set(objects).add(value);
		let positionalArray =
			value.type === "array" ||
			(Array.isArray(value.type) && value.type.includes("array"));
		let formDataArrayProperty = false;
		let schemaReferenceUnresolved = false;
		const inspect = (child: unknown, nextRefs = refs) => {
			const result = scan(child, depth + 1, nextRefs, nextObjects);
			positionalArray ||= result.positionalArray;
			formDataArrayProperty ||= result.formDataArrayProperty;
			schemaReferenceUnresolved ||= result.schemaReferenceUnresolved;
		};
		if (typeof value.$ref === "string") {
			const ref = value.$ref;
			if (!ref.startsWith("#") || refs.has(ref) || refs.size >= 128)
				schemaReferenceUnresolved = true;
			else {
				const resolved = resolveJSONPointer(document, ref);
				if (!resolved.found) schemaReferenceUnresolved = true;
				else inspect(resolved.value, new Set(refs).add(ref));
			}
		}
		for (const keyword of ["allOf", "anyOf", "oneOf"] as const) {
			const branches = value[keyword];
			if (Array.isArray(branches))
				for (const branch of branches) inspect(branch);
		}
		for (const keyword of ["then", "else"] as const)
			if (Object.hasOwn(value, keyword)) inspect(value[keyword]);
		if (checkFormDataProperties && isRecord(value.properties)) {
			for (const property of Object.values(value.properties)) {
				const result = scan(property, depth + 1, refs, nextObjects);
				formDataArrayProperty ||=
					result.positionalArray || result.formDataArrayProperty;
				schemaReferenceUnresolved ||= result.schemaReferenceUnresolved;
			}
		}
		return {
			positionalArray,
			formDataArrayProperty,
			schemaReferenceUnresolved,
		};
	};
	return scan(schema, 0, new Set(), new Set());
}

function hasNestedMultipart(
	media: Record<string, unknown>,
	semantics: OpenAPI32MediaTypeSemantics,
): boolean {
	if (semantics.encodingState !== "active" || !isRecord(media.encoding))
		return false;
	const seen = new WeakSet<object>();
	const visit = (value: unknown, depth: number): boolean => {
		if (!isRecord(value)) return false;
		if (seen.has(value) || depth >= 16) return true;
		seen.add(value);
		const contentType = value.contentType;
		if (typeof contentType !== "string")
			return (
				Object.hasOwn(value, "prefixEncoding") ||
				Object.hasOwn(value, "itemEncoding")
			);
		const candidates = classifyOpenAPI32EncodingContentTypes(
			contentType,
			value,
		);
		if (candidates.some((candidate) => candidate.family === "multipart"))
			return true;
		if (
			candidates.some((candidate) => candidate.encodingState === "active") &&
			isRecord(value.encoding)
		) {
			for (const nested of Object.values(value.encoding))
				if (visit(nested, depth + 1)) return true;
		}
		return false;
	};
	for (const value of Object.values(media.encoding))
		if (visit(value, 0)) return true;
	return false;
}

/** Inspect every media entry of a request body or response without selecting one codec. */
export function inspectOpenAPI32MediaContent(
	document: unknown,
	holder: unknown,
	path: readonly (string | number)[],
): OpenAPI32MediaEntry[] {
	if (holder === undefined) return [];
	const object = resolveObject(document, holder);
	if (!object.value)
		return [
			{
				mediaType: "",
				path: [...path],
				positionalArray: false,
				formDataArrayProperty: false,
				schemaReferenceUnresolved: false,
				nestedMultipart: false,
				resolution: "unresolved",
			},
		];
	if (!isRecord(object.value.content)) return [];
	return Object.keys(object.value.content)
		.sort()
		.map((mediaType) => {
			const mediaPath = [...path, "content", mediaType];
			const media =
				object.value?.content &&
				(object.value.content as Record<string, unknown>)[mediaType];
			const resolved = resolveObject(document, media);
			if (!resolved.value)
				return {
					mediaType,
					path: mediaPath,
					positionalArray: false,
					formDataArrayProperty: false,
					schemaReferenceUnresolved: false,
					nestedMultipart: false,
					resolution: "unresolved",
				};
			const semantics = classifyOpenAPI32MediaType(mediaType, resolved.value);
			return {
				mediaType,
				path: mediaPath,
				semantics,
				mediaObject: resolved.value,
				...schemaShape(
					document,
					resolved.value.schema,
					semantics.family === "multipart" &&
						semantics.normalizedMediaType === "multipart/form-data",
				),
				nestedMultipart: hasNestedMultipart(resolved.value, semantics),
				resolution: resolved.resolved ? "resolved" : "inline",
			};
		});
}

export function inspectOpenAPI32OperationMedia(
	operation: Operation,
	path: readonly (string | number)[],
): OpenAPI32MediaEntry[] {
	const document = operation.api;
	const entries = inspectOpenAPI32MediaContent(
		document,
		operation.schema?.requestBody,
		[...path, "requestBody"],
	);
	entries.push(...inspectOpenAPI32QuerystringMedia(operation, path));
	const responses = operation.schema?.responses ?? {};
	for (const status of Object.keys(responses).sort()) {
		entries.push(
			...inspectOpenAPI32MediaContent(document, responses[status], [
				...path,
				"responses",
				status,
			]),
		);
	}
	return entries;
}

/** Inspect the effective querystring parameter, including path-level and referenced parameters. */
export function inspectOpenAPI32QuerystringMedia(
	operation: Operation,
	path: readonly (string | number)[],
): OpenAPI32MediaEntry[] {
	const document = operation.api;
	const pathItem = document?.paths?.[operation.path];
	const parameters = effectiveParameters(
		document,
		isRecord(pathItem) ? pathItem : {},
		isRecord(operation.schema) ? operation.schema : {},
		path.slice(0, -1),
		[...path],
	);
	return parameters
		.filter(({ value }) => value.in === "querystring")
		.flatMap(({ value, path: parameterPath }) =>
			inspectOpenAPI32MediaContent(document, value, parameterPath),
		);
}
