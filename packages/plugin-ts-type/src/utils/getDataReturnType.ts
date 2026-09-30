import {
	describeOperationResponses,
	type OperationWrapper,
	resolveJSONPointer,
} from "@openapi-to/core";

const MAX_SCHEMA_INSPECTION_DEPTH = 64;

interface InspectableSchema extends Record<string, unknown> {
	$ref?: string;
	allOf?: unknown[];
	properties?: Record<string, unknown>;
}

export function getDataReturnType(operation: OperationWrapper): string[] {
	const responseSchema = describeOperationResponses(
		operation.accessor.operation,
	)
		.filter((response) => /^2\d{2}$|^300$/.test(response.statusCode))
		.flatMap((response) => {
			if (response.contentType) {
				return [
					response.inspection?.find(
						(inspection) => inspection.contentType === response.contentType,
					),
				];
			}
			return response.kind === "no-content" ? [] : [response.inspection?.[0]];
		})
		.find((inspection) => inspection?.schema !== undefined)?.schema;

	if (
		typeof responseSchema !== "object" ||
		responseSchema === null ||
		Array.isArray(responseSchema)
	) {
		return [];
	}

	const propertyNames: string[] = [];
	const seenNames = new Set<string>();
	const seenRefs = new Set<string>();
	const seenSchemas = new WeakSet<object>();
	const pending: Array<{ depth: number; schema: InspectableSchema }> = [
		{ depth: 0, schema: responseSchema as InspectableSchema },
	];

	while (pending.length > 0) {
		const current = pending.pop();
		if (!current || current.depth > MAX_SCHEMA_INSPECTION_DEPTH) continue;
		const schema = current.schema;
		if (seenSchemas.has(schema)) continue;
		seenSchemas.add(schema);

		if (typeof schema.$ref === "string" && !seenRefs.has(schema.$ref)) {
			seenRefs.add(schema.$ref);
			const resolved = resolveJSONPointer(
				operation.accessor.operation.api,
				schema.$ref,
			);
			if (
				resolved.found &&
				typeof resolved.value === "object" &&
				resolved.value !== null &&
				!Array.isArray(resolved.value)
			) {
				pending.push({
					depth: current.depth + 1,
					schema: resolved.value as InspectableSchema,
				});
			}
		}

		for (const name of Object.keys(schema.properties ?? {})) {
			if (seenNames.has(name)) continue;
			seenNames.add(name);
			propertyNames.push(name);
		}

		if (Array.isArray(schema.allOf)) {
			for (let index = schema.allOf.length - 1; index >= 0; index -= 1) {
				const member = schema.allOf[index];
				if (
					typeof member !== "object" ||
					member === null ||
					Array.isArray(member)
				)
					continue;
				pending.push({
					depth: current.depth + 1,
					schema: member as InspectableSchema,
				});
			}
		}
	}

	return propertyNames;
}
