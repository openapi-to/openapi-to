/** The OpenAPI source dialect retained by the compiler. */
export type OpenAPIDialect = "3.0" | "3.1" | "3.2" | "unknown";

/** The context in which an OpenAPI object containing `$ref` is interpreted. */
export type OpenAPIRefObjectContext = "schema" | "reference";

export type OpenAPIRefSemanticContext = {
	dialect: OpenAPIDialect;
	objectContext: OpenAPIRefObjectContext;
};

/** Classify only explicitly maintained OpenAPI 3.x dialects. */
export function classifyOpenAPIDialect(version: unknown): OpenAPIDialect {
	if (typeof version !== "string") return "unknown";
	const match = /^3\.(0|1|2)(?:\.|$)/.exec(version);
	if (!match) return "unknown";
	return `3.${match[1]}` as OpenAPIDialect;
}

/** Whether validation keywords alongside `$ref` participate in schema meaning. */
export function hasActiveSchemaRefSiblings(
	context: OpenAPIRefSemanticContext,
): boolean {
	return (
		context.objectContext === "schema" &&
		(context.dialect === "3.1" || context.dialect === "3.2")
	);
}
