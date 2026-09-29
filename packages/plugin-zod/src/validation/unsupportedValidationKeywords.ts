import {
	hasActiveSchemaRefSiblings,
	type OpenAPIRefSemanticContext,
} from "@openapi-to/core";

type SchemaRecord = Record<string, unknown>;

export type UnsupportedValidationKeywordOccurrence = {
	keyword: string;
	path: string[];
};

export type UnsupportedValidationKeywordScan = {
	occurrences: UnsupportedValidationKeywordOccurrence[];
	keywords: string[];
	exceededLimit: boolean;
};

export type UnsupportedValidationKeywordScanOptions = {
	refSemanticContext?: OpenAPIRefSemanticContext;
};

const MAX_SCHEMA_NODES = 10_000;
const MAX_SCHEMA_DEPTH = 128;
const MAX_RECORDED_OCCURRENCES = 64;

const jsonSchema2020UnsupportedValidationKeywords = new Set([
	"not",
	"uniqueItems",
	"minProperties",
	"maxProperties",
	"dependentRequired",
	"prefixItems",
	"contains",
	"minContains",
	"maxContains",
	"patternProperties",
	"dependentSchemas",
	"propertyNames",
	"if",
	"then",
	"else",
	"unevaluatedItems",
	"unevaluatedProperties",
	"$dynamicRef",
]);

const unsupportedValidationKeywordsByDialect: Record<
	string,
	ReadonlySet<string>
> = {
	"3.0": new Set(["not", "uniqueItems", "minProperties", "maxProperties"]),
	"3.1": jsonSchema2020UnsupportedValidationKeywords,
	"3.2": jsonSchema2020UnsupportedValidationKeywords,
};

function isRecord(value: unknown): value is SchemaRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSchema(value: unknown): value is SchemaRecord {
	return isRecord(value);
}

/**
 * Find known standard validation keywords that the Zod renderer does not
 * implement. Traversal follows only maintained schema-bearing keywords; values
 * such as examples, defaults, extensions, and arbitrary annotations are data.
 */
export function findUnsupportedValidationKeywords(
	schema: unknown,
	options: UnsupportedValidationKeywordScanOptions = {},
): UnsupportedValidationKeywordScan {
	const occurrences: UnsupportedValidationKeywordOccurrence[] = [];
	const keywords = new Set<string>();
	const visited = new WeakSet<object>();
	const stack: Array<{ value: unknown; path: string[]; depth: number }> = [
		{ value: schema, path: [], depth: 0 },
	];
	const unsupported = options.refSemanticContext
		? unsupportedValidationKeywordsByDialect[options.refSemanticContext.dialect]
		: undefined;
	let visitedNodes = 0;
	let exceededLimit = false;

	while (stack.length > 0) {
		const current = stack.pop();
		if (!current || !isSchema(current.value)) continue;
		if (visited.has(current.value)) continue;
		visited.add(current.value);

		visitedNodes += 1;
		if (visitedNodes > MAX_SCHEMA_NODES || current.depth > MAX_SCHEMA_DEPTH) {
			exceededLimit = true;
			break;
		}

		const record = current.value;
		if (typeof record.$ref === "string") {
			const refContext = options.refSemanticContext;
			if (refContext && !hasActiveSchemaRefSiblings(refContext)) continue;
		}

		if (unsupported) {
			for (const keyword of unsupported) {
				if (Object.hasOwn(record, keyword)) {
					keywords.add(keyword);
					if (occurrences.length < MAX_RECORDED_OCCURRENCES) {
						occurrences.push({ keyword, path: [...current.path, keyword] });
					}
				}
			}
		}

		const queueSchema = (value: unknown, path: string[]) => {
			if (!isSchema(value)) return;
			if (visitedNodes + stack.length >= MAX_SCHEMA_NODES) {
				exceededLimit = true;
				return;
			}
			stack.push({ value, path, depth: current.depth + 1 });
		};
		const addSchemaMap = (value: unknown, path: string[]) => {
			if (!isRecord(value)) return;
			for (const key in value) {
				if (!Object.hasOwn(value, key)) continue;
				queueSchema(value[key], [...path, key]);
				if (exceededLimit) return;
			}
		};
		const addSchemaArray = (value: unknown, path: string[]) => {
			if (!Array.isArray(value)) return;
			for (let index = 0; index < value.length; index += 1) {
				queueSchema(value[index], [...path, String(index)]);
				if (exceededLimit) return;
			}
		};

		addSchemaMap(record.properties, [...current.path, "properties"]);
		addSchemaMap(record.patternProperties, [
			...current.path,
			"patternProperties",
		]);
		addSchemaMap(record.dependentSchemas, [
			...current.path,
			"dependentSchemas",
		]);
		queueSchema(record.items, [...current.path, "items"]);
		addSchemaArray(record.items, [...current.path, "items"]);
		addSchemaArray(record.prefixItems, [...current.path, "prefixItems"]);
		addSchemaArray(record.allOf, [...current.path, "allOf"]);
		addSchemaArray(record.anyOf, [...current.path, "anyOf"]);
		addSchemaArray(record.oneOf, [...current.path, "oneOf"]);
		for (const keyword of [
			"not",
			"additionalProperties",
			"contains",
			"propertyNames",
			"if",
			"then",
			"else",
			"unevaluatedItems",
			"unevaluatedProperties",
		] as const) {
			queueSchema(record[keyword], [...current.path, keyword]);
		}
		if (exceededLimit) break;
	}

	return {
		occurrences,
		keywords: [...keywords].sort(),
		exceededLimit,
	};
}

export function unsupportedValidationKeywordDiagnosticMessage(
	scan: UnsupportedValidationKeywordScan,
): string {
	if (scan.exceededLimit) {
		return "The schema semantic scan exceeded its bounded traversal limit; generated z.never() to avoid silently widening validation.";
	}
	const visible = scan.keywords
		.slice(0, 8)
		.map((keyword) => JSON.stringify(keyword));
	const omitted = scan.keywords.length - visible.length;
	const list = `${visible.join(", ")}${omitted > 0 ? `, ${omitted} more` : ""}`;
	return `Unsupported validation keyword(s): ${list}. Generated z.never() to avoid silently widening validation.`;
}
