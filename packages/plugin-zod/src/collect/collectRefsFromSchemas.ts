import {
	hasActiveSchemaRefSiblings,
	type OpenAPIRefSemanticContext,
	type Schema,
} from "@openapi-to/core";

export type CollectRefsFromSchemaOptions = {
	omitUnguardedRefsWithinOneOf?: ReadonlySet<string>;
	refSemanticContext?: OpenAPIRefSemanticContext;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function collectRefsFromSchema(
	schema: Schema,
	options: CollectRefsFromSchemaOptions = {},
): string[] {
	const refs = new Set<string>();

	function walk(
		value: unknown,
		withinOneOfBranch = false,
		structuralGuard = false,
	): void {
		if (!isRecord(value)) return;

		if (
			typeof value.$ref === "string" &&
			!(
				withinOneOfBranch &&
				!structuralGuard &&
				options.omitUnguardedRefsWithinOneOf?.has(value.$ref)
			)
		) {
			refs.add(value.$ref);
		}
		if (
			typeof value.$ref === "string" &&
			options.refSemanticContext &&
			!hasActiveSchemaRefSiblings(options.refSemanticContext)
		) {
			return;
		}

		if (isRecord(value.properties)) {
			Object.values(value.properties).forEach((property) => {
				walk(property, withinOneOfBranch, structuralGuard || withinOneOfBranch);
			});
		}

		if (Array.isArray(value.items)) {
			value.items.forEach((item) => {
				walk(item, withinOneOfBranch, structuralGuard || withinOneOfBranch);
			});
		} else {
			walk(
				value.items,
				withinOneOfBranch,
				structuralGuard || withinOneOfBranch,
			);
		}

		for (const key of ["allOf", "anyOf", "oneOf"] as const) {
			const composed = value[key];
			if (Array.isArray(composed)) {
				composed.forEach((member) => {
					walk(member, withinOneOfBranch || key === "oneOf", structuralGuard);
				});
			}
		}

		walk(value.not, withinOneOfBranch, structuralGuard);
		walk(
			value.additionalProperties,
			withinOneOfBranch,
			structuralGuard || withinOneOfBranch,
		);
	}

	walk(schema);
	return [...refs];
}
