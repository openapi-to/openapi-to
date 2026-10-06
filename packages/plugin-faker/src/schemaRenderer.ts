import {
	classifyOpenAPIDialect,
	resolveJSONPointer,
	type OpenAPIDialect,
	type Schema,
} from "@openapi-to/core";
import { isIP } from "node:net";

export const MAX_RECURSION_DEPTH = 4;
export const MAX_ARRAY_ITEMS = 32;
export const MAX_SYNTHETIC_STRING_LENGTH = 1024;
export const MAX_COMPOSITION_BRANCHES = 32;
export const MAX_SCHEMA_NODES_PER_FACTORY = 10_000;

const referenceAnnotationKeys = new Set([
	"$ref",
	"$comment",
	"description",
	"title",
	"deprecated",
	"readOnly",
	"writeOnly",
	"example",
	"examples",
	"default",
	"nullable",
]);

export type FakerDiagnostic = {
	code: string;
	severity: "error" | "warning";
	message: string;
	path: Array<string | number>;
};

export class SchemaRenderError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly path: Array<string | number>,
	) {
		super(message);
	}
}

type RenderContext = {
	document: unknown;
	dialect: OpenAPIDialect;
	path: Array<string | number>;
	diagnostics: FakerDiagnostic[];
	nodes: { value: number };
	scanNodes: { value: number };
	refs: string[];
};

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compare(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function getType(schema: RecordValue): string | undefined {
	const type = schema.type;
	if (typeof type === "string") return type;
	if (Array.isArray(type)) {
		const selected = type.find((item) => item !== "null");
		return typeof selected === "string" ? selected : "null";
	}
	if (
		schema.properties !== undefined ||
		schema.additionalProperties !== undefined
	)
		return "object";
	if (schema.items !== undefined || schema.prefixItems !== undefined)
		return "array";
	if (
		schema.format !== undefined ||
		schema.minLength !== undefined ||
		schema.maxLength !== undefined
	)
		return "string";
	if (
		[
			"minimum",
			"maximum",
			"exclusiveMinimum",
			"exclusiveMaximum",
			"multipleOf",
		].some((key) => schema[key] !== undefined)
	)
		return "number";
	return undefined;
}

function hasUnsupportedValidation(schema: RecordValue): string | undefined {
	const unsupported = [
		"pattern",
		"not",
		"$dynamicRef",
		"contains",
		"minContains",
		"maxContains",
		"patternProperties",
		"propertyNames",
		"dependentSchemas",
		"dependentRequired",
		"if",
		"then",
		"else",
		"unevaluatedItems",
		"unevaluatedProperties",
		"contentSchema",
		"contentEncoding",
		"contentMediaType",
		"discriminator",
		"xml",
		"externalDocs",
		"readOnly",
		"writeOnly",
	];
	return unsupported.find((key) => schema[key] !== undefined);
}

function resolveRef(context: RenderContext, ref: string): unknown {
	if (!ref.startsWith("#/components/schemas/")) {
		throw new SchemaRenderError(
			"FAKER_EXTERNAL_REF_UNSUPPORTED",
			"Only local component schema references are supported.",
			context.path,
		);
	}
	const resolved = resolveJSONPointer(context.document, ref);
	if (!resolved.found) {
		throw new SchemaRenderError(
			"FAKER_EXTERNAL_REF_UNSUPPORTED",
			"The local schema reference is not available in the projected document.",
			context.path,
		);
	}
	return resolved.value;
}

function validateLiteral(
	value: unknown,
	schema: RecordValue,
	dialect: OpenAPIDialect,
): boolean {
	if (value !== null && (Array.isArray(value) || isRecord(value))) return false;
	const type = getType(schema);
	if (value === null) {
		if (!nullable(schema, dialect) && type && type !== "null") return false;
	} else if (type === "string" && typeof value !== "string") return false;
	else if (type === "boolean" && typeof value !== "boolean") return false;
	else if (type === "integer" && !Number.isSafeInteger(value)) return false;
	else if (
		type === "number" &&
		(typeof value !== "number" || !Number.isFinite(value))
	)
		return false;
	else if (type === "array" && !Array.isArray(value)) return false;
	else if (type === "object" && !isRecord(value)) return false;
	if (
		"const" in schema &&
		JSON.stringify(value) !== JSON.stringify(schema.const)
	)
		return false;
	if (
		Array.isArray(schema.enum) &&
		!schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))
	)
		return false;
	if (typeof value === "string") {
		if (typeof schema.minLength === "number" && value.length < schema.minLength)
			return false;
		if (typeof schema.maxLength === "number" && value.length > schema.maxLength)
			return false;
		if (typeof schema.format === "string") {
			switch (schema.format) {
				case "email":
					if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return false;
					break;
				case "uuid":
					if (
						!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
							value,
						)
					)
						return false;
					break;
				case "uri":
				case "url":
					try {
						const parsed = new URL(value);
						if (!parsed.protocol || !parsed.hostname) return false;
					} catch {
						return false;
					}
					break;
				case "hostname":
					if (
						value.length > 253 ||
						!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/i.test(
							value,
						)
					)
						return false;
					break;
				case "ipv4":
					if (isIP(value) !== 4) return false;
					break;
				case "ipv6":
					if (isIP(value) !== 6) return false;
					break;
				case "date": {
					if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
					const date = new Date(`${value}T00:00:00.000Z`);
					if (
						!Number.isFinite(date.getTime()) ||
						date.toISOString().slice(0, 10) !== value
					)
						return false;
					break;
				}
				case "date-time": {
					const match =
						/^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(
							value,
						);
					if (!match?.[1]) return false;
					const date = new Date(`${match[1]}T00:00:00.000Z`);
					if (
						!Number.isFinite(date.getTime()) ||
						date.toISOString().slice(0, 10) !== match[1] ||
						!Number.isFinite(Date.parse(value))
					)
						return false;
					break;
				}
				case "time":
					if (
						!/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
							value,
						)
					)
						return false;
					break;
				case "duration":
					if (
						!/^P(?:\d+W|(?=\d|T\d)(?:\d+Y)?(?:\d+M)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?)$/.test(
							value,
						)
					)
						return false;
					break;
				case "byte":
				case "binary":
					return false;
			}
		}
	}
	if (typeof value === "number") {
		if (
			schema.format === "int32" &&
			(!Number.isInteger(value) ||
				value < -2_147_483_648 ||
				value > 2_147_483_647)
		)
			return false;
		if (schema.format === "int64" && !Number.isSafeInteger(value)) return false;
		if (typeof schema.minimum === "number" && value < schema.minimum)
			return false;
		if (typeof schema.maximum === "number" && value > schema.maximum)
			return false;
		if (
			typeof schema.exclusiveMinimum === "number" &&
			value <= schema.exclusiveMinimum
		)
			return false;
		if (
			schema.exclusiveMinimum === true &&
			typeof schema.minimum === "number" &&
			value <= schema.minimum
		)
			return false;
		if (
			typeof schema.exclusiveMaximum === "number" &&
			value >= schema.exclusiveMaximum
		)
			return false;
		if (
			schema.exclusiveMaximum === true &&
			typeof schema.maximum === "number" &&
			value >= schema.maximum
		)
			return false;
		if (
			typeof schema.multipleOf === "number" &&
			!isMultipleOf(value, schema.multipleOf)
		)
			return false;
	}
	if (Array.isArray(value)) {
		if (typeof schema.minItems === "number" && value.length < schema.minItems)
			return false;
		if (typeof schema.maxItems === "number" && value.length > schema.maxItems)
			return false;
		if (
			schema.uniqueItems === true &&
			new Set(value.map((item) => JSON.stringify(item))).size !== value.length
		)
			return false;
	}
	if (isRecord(value)) {
		const required = Array.isArray(schema.required)
			? schema.required.filter(
					(item): item is string => typeof item === "string",
				)
			: [];
		if (required.some((key) => !Object.hasOwn(value, key))) return false;
		if (
			typeof schema.maxProperties === "number" &&
			Object.keys(value).length > schema.maxProperties
		)
			return false;
		if (
			typeof schema.minProperties === "number" &&
			Object.keys(value).length < schema.minProperties
		)
			return false;
	}
	return true;
}

function scalarEnum(schema: RecordValue): unknown[] | undefined {
	if (!Array.isArray(schema.enum) || schema.enum.length === 0) return undefined;
	if (
		schema.enum.every(
			(value) =>
				value === null ||
				["string", "number", "boolean"].includes(typeof value),
		)
	)
		return schema.enum;
	return undefined;
}

function scalarTypes(schema: RecordValue): Set<string> | undefined {
	const declared =
		typeof schema.type === "string"
			? [schema.type]
			: Array.isArray(schema.type)
				? schema.type.filter(
						(value): value is string => typeof value === "string",
					)
				: undefined;
	const values = "const" in schema ? [schema.const] : scalarEnum(schema);
	if (declared) return new Set(declared);
	if (values) {
		const types = new Set(
			values.map((value) =>
				value === null
					? "null"
					: typeof value === "number" && Number.isInteger(value)
						? "integer"
						: typeof value,
			),
		);
		return types;
	}
	const inferred = getType(schema);
	return inferred ? new Set([inferred]) : undefined;
}

function finiteScalarDomain(schema: RecordValue): unknown[] | undefined {
	if ("const" in schema) return [schema.const];
	return scalarEnum(schema);
}

function provablyExclusive(
	left: RecordValue,
	right: RecordValue,
	dialect: OpenAPIDialect,
): boolean {
	const leftTypes = scalarTypes(left);
	const rightTypes = scalarTypes(right);
	if (
		leftTypes &&
		rightTypes &&
		[...leftTypes].every(
			(type) =>
				!rightTypes.has(type) &&
				!(type === "integer" && rightTypes.has("number")) &&
				!(type === "number" && rightTypes.has("integer")),
		)
	)
		return true;
	const leftDomain = finiteScalarDomain(left);
	const rightDomain = finiteScalarDomain(right);
	if (
		leftDomain &&
		rightDomain &&
		leftDomain.every((value) =>
			rightDomain.every(
				(other) => JSON.stringify(value) !== JSON.stringify(other),
			),
		)
	)
		return true;
	if (leftDomain?.every((value) => !validateLiteral(value, right, dialect)))
		return true;
	if (rightDomain?.every((value) => !validateLiteral(value, left, dialect)))
		return true;
	return false;
}

function ensureCompositionHasNoValidationSiblings(
	schema: RecordValue,
	keyword: string,
	path: Array<string | number>,
): void {
	const annotationKeys = new Set([
		"$comment",
		"description",
		"title",
		"deprecated",
		"readOnly",
		"writeOnly",
		"example",
		"examples",
		"default",
		keyword,
	]);
	if (Object.keys(schema).some((key) => !annotationKeys.has(key))) {
		throw new SchemaRenderError(
			"FAKER_UNSUPPORTED_COMPOSITION",
			`Validation keywords alongside ${keyword} are not supported.`,
			path,
		);
	}
}

function literalCandidate(
	schema: RecordValue,
	context: RenderContext,
): string | undefined {
	if ("const" in schema) {
		if (schema.const !== null && typeof schema.const === "object")
			throw new SchemaRenderError(
				"FAKER_UNSUPPORTED_SCHEMA",
				"Only scalar const values are supported.",
				context.path,
			);
		if (schema.format === "byte" || schema.format === "binary")
			throw new SchemaRenderError(
				"FAKER_UNSUPPORTED_FORMAT",
				`The ${schema.format} format is not supported.`,
				context.path,
			);
		if (!validateLiteral(schema.const, schema, context.dialect))
			throw new SchemaRenderError(
				"FAKER_UNSATISFIABLE_CONSTRAINT",
				"The const value violates the schema constraints.",
				context.path,
			);
		return JSON.stringify(schema.const);
	}
	const candidates: unknown[] = [];
	if (Array.isArray(schema.examples)) candidates.push(...schema.examples);
	if ("example" in schema) candidates.push(schema.example);
	if ("default" in schema) candidates.push(schema.default);
	for (const candidate of candidates) {
		if (validateLiteral(candidate, schema, context.dialect))
			return JSON.stringify(candidate);
		context.diagnostics.push({
			code: "FAKER_INVALID_LITERAL_CANDIDATE",
			severity: "warning",
			message:
				"A schema literal candidate could not be proven valid with the bounded schema checks and was skipped.",
			path: context.path,
		});
	}
	if (Array.isArray(schema.enum)) {
		if (schema.enum.length === 0)
			throw new SchemaRenderError(
				"FAKER_UNSATISFIABLE_CONSTRAINT",
				"An empty enum has no valid value.",
				context.path,
			);
		if (schema.format === "byte" || schema.format === "binary")
			throw new SchemaRenderError(
				"FAKER_UNSUPPORTED_FORMAT",
				`The ${schema.format} format is not supported.`,
				context.path,
			);
		const values = scalarEnum(schema);
		if (!values)
			throw new SchemaRenderError(
				"FAKER_UNSUPPORTED_SCHEMA",
				"Only scalar enum values are supported.",
				context.path,
			);
		const validValues = values.filter((value) =>
			validateLiteral(value, schema, context.dialect),
		);
		if (validValues.length === 0)
			throw new SchemaRenderError(
				"FAKER_UNSATISFIABLE_CONSTRAINT",
				"No enum value satisfies the schema constraints.",
				context.path,
			);
		return validValues.length === 1
			? JSON.stringify(validValues[0])
			: `faker.helpers.arrayElement(${JSON.stringify(validValues)})`;
	}
	return undefined;
}

function numberBounds(
	schema: RecordValue,
	integer: boolean,
): { min: number; max: number } {
	let min = integer ? Number.MIN_SAFE_INTEGER : -1_000_000;
	let max = integer ? Number.MAX_SAFE_INTEGER : 1_000_000;
	if (typeof schema.minimum === "number") min = Math.max(min, schema.minimum);
	if (typeof schema.maximum === "number") max = Math.min(max, schema.maximum);
	const exclusiveMinimum =
		typeof schema.exclusiveMinimum === "number"
			? schema.exclusiveMinimum
			: schema.exclusiveMinimum === true && typeof schema.minimum === "number"
				? schema.minimum
				: undefined;
	const exclusiveMaximum =
		typeof schema.exclusiveMaximum === "number"
			? schema.exclusiveMaximum
			: schema.exclusiveMaximum === true && typeof schema.maximum === "number"
				? schema.maximum
				: undefined;
	if (exclusiveMinimum !== undefined)
		min = Math.max(
			min,
			integer
				? Math.floor(exclusiveMinimum) + 1
				: exclusiveMinimum +
						Number.EPSILON * Math.max(1, Math.abs(exclusiveMinimum)),
		);
	if (exclusiveMaximum !== undefined)
		max = Math.min(
			max,
			integer
				? Math.ceil(exclusiveMaximum) - 1
				: exclusiveMaximum -
						Number.EPSILON * Math.max(1, Math.abs(exclusiveMaximum)),
		);
	if (integer) {
		min = Math.ceil(min);
		max = Math.floor(max);
	}
	if (min > max || !Number.isFinite(min) || !Number.isFinite(max))
		throw new SchemaRenderError(
			"FAKER_UNSATISFIABLE_CONSTRAINT",
			"The numeric constraints have no finite supported value.",
			[],
		);
	return { min, max };
}

function greatestCommonDivisor(left: number, right: number): number {
	let a = Math.abs(left);
	let b = Math.abs(right);
	while (b !== 0) [a, b] = [b, a % b];
	return a;
}

function decimalFraction(value: number): {
	numerator: number;
	denominator: number;
} {
	const [mantissa = "", exponentText] = String(value).toLowerCase().split("e");
	const exponent = exponentText === undefined ? 0 : Number(exponentText);
	const fractionalDigits = mantissa.split(".")[1]?.length ?? 0;
	const decimalPlaces = Math.max(0, fractionalDigits - exponent);
	if (decimalPlaces > 12)
		throw new SchemaRenderError(
			"FAKER_UNSUPPORTED_SCHEMA",
			"integer multipleOf with more than 12 decimal places is not supported.",
			[],
		);
	const denominator = 10 ** decimalPlaces;
	const numerator = Math.round(value * denominator);
	if (!Number.isSafeInteger(numerator))
		throw new SchemaRenderError(
			"FAKER_UNSUPPORTED_SCHEMA",
			"integer multipleOf cannot be represented safely.",
			[],
		);
	return { numerator, denominator };
}

function decimalFractionBigInt(value: number): {
	numerator: bigint;
	denominator: bigint;
} {
	const [mantissa = "", exponentText] = String(value).toLowerCase().split("e");
	const exponent = exponentText === undefined ? 0 : Number(exponentText);
	const negative = mantissa.startsWith("-");
	const unsigned = negative ? mantissa.slice(1) : mantissa;
	const fractionalDigits = unsigned.split(".")[1]?.length ?? 0;
	const digits = unsigned.replace(".", "");
	let numerator = BigInt(digits || "0");
	let denominator = 1n;
	const scale = exponent - fractionalDigits;
	if (scale >= 0) numerator *= 10n ** BigInt(scale);
	else denominator = 10n ** BigInt(-scale);
	if (negative) numerator *= -1n;
	return { numerator, denominator };
}

function bigintFloorDiv(numerator: bigint, denominator: bigint): bigint {
	const quotient = numerator / denominator;
	const remainder = numerator % denominator;
	return remainder < 0n ? quotient - 1n : quotient;
}

function bigintCeilDiv(numerator: bigint, denominator: bigint): bigint {
	return -bigintFloorDiv(-numerator, denominator);
}

function isMultipleOf(value: number, multiple: number): boolean {
	if (!Number.isFinite(value) || !Number.isFinite(multiple) || multiple <= 0)
		return false;
	const valueFraction = decimalFractionBigInt(value);
	const multipleFraction = decimalFractionBigInt(multiple);
	return (
		(valueFraction.numerator * multipleFraction.denominator) %
			(valueFraction.denominator * multipleFraction.numerator) ===
		0n
	);
}

function floatMultipleBounds(schema: RecordValue): {
	min: number;
	max: number;
	multipleNumerator: number;
	multipleDenominator: number;
} {
	const multiple = schema.multipleOf as number;
	if (!Number.isFinite(multiple) || multiple <= 0)
		throw new SchemaRenderError(
			"FAKER_UNSATISFIABLE_CONSTRAINT",
			"multipleOf must be a positive finite number.",
			[],
		);
	const factor = decimalFractionBigInt(multiple);
	const minimumBound =
		typeof schema.minimum === "number" ? schema.minimum : -1_000_000;
	const exclusiveMinimum =
		typeof schema.exclusiveMinimum === "number"
			? schema.exclusiveMinimum
			: schema.exclusiveMinimum === true
				? minimumBound
				: undefined;
	const maximumBound =
		typeof schema.maximum === "number" ? schema.maximum : 1_000_000;
	const exclusiveMaximum =
		typeof schema.exclusiveMaximum === "number"
			? schema.exclusiveMaximum
			: schema.exclusiveMaximum === true
				? maximumBound
				: undefined;
	const minimum = Math.max(
		-1_000_000,
		minimumBound,
		exclusiveMinimum ?? -1_000_000,
	);
	const maximum = Math.min(
		1_000_000,
		maximumBound,
		exclusiveMaximum ?? 1_000_000,
	);
	const minimumFraction = decimalFractionBigInt(minimum);
	const maximumFraction = decimalFractionBigInt(maximum);
	const minRatioNumerator = minimumFraction.numerator * factor.denominator;
	const minRatioDenominator = minimumFraction.denominator * factor.numerator;
	const maxRatioNumerator = maximumFraction.numerator * factor.denominator;
	const maxRatioDenominator = maximumFraction.denominator * factor.numerator;
	const low =
		exclusiveMinimum !== undefined && exclusiveMinimum >= minimumBound
			? bigintFloorDiv(minRatioNumerator, minRatioDenominator) + 1n
			: bigintCeilDiv(minRatioNumerator, minRatioDenominator);
	const high =
		exclusiveMaximum !== undefined && exclusiveMaximum <= maximumBound
			? bigintCeilDiv(maxRatioNumerator, maxRatioDenominator) - 1n
			: bigintFloorDiv(maxRatioNumerator, maxRatioDenominator);
	const min = Number(low);
	const max = Number(high);
	const multipleNumerator = Number(factor.numerator);
	const multipleDenominator = Number(factor.denominator);
	if (
		low > high ||
		!Number.isSafeInteger(min) ||
		!Number.isSafeInteger(max) ||
		!Number.isSafeInteger(multipleNumerator) ||
		!Number.isSafeInteger(multipleDenominator)
	)
		throw new SchemaRenderError(
			"FAKER_UNSATISFIABLE_CONSTRAINT",
			"The numeric multipleOf constraints have no representable supported value.",
			[],
		);
	return { min, max, multipleNumerator, multipleDenominator };
}

function finiteMultipleBounds(
	schema: RecordValue,
	integer: boolean,
): { min: number; max: number; multiple?: number } {
	const { min, max } = numberBounds(schema, integer);
	const multiple =
		typeof schema.multipleOf === "number" ? schema.multipleOf : undefined;
	if (multiple !== undefined && (!Number.isFinite(multiple) || multiple <= 0))
		throw new SchemaRenderError(
			"FAKER_UNSATISFIABLE_CONSTRAINT",
			"multipleOf must be a positive finite number.",
			[],
		);
	if (multiple === undefined) return { min, max };
	let low = Math.ceil(min / multiple);
	let high = Math.floor(max / multiple);
	if (integer) {
		const { denominator, numerator } = decimalFraction(multiple);
		const period = denominator / greatestCommonDivisor(numerator, denominator);
		low = Math.ceil(low / period);
		high = Math.floor(high / period);
		if (low > high || !Number.isSafeInteger(low) || !Number.isSafeInteger(high))
			throw new SchemaRenderError(
				"FAKER_UNSATISFIABLE_CONSTRAINT",
				"The numeric multipleOf constraints have no representable supported value.",
				[],
			);
		return { min: low, max: high, multiple: period * multiple };
	}
	if (low > high || !Number.isSafeInteger(low) || !Number.isSafeInteger(high))
		throw new SchemaRenderError(
			"FAKER_UNSATISFIABLE_CONSTRAINT",
			"The numeric multipleOf constraints have no representable supported value.",
			[],
		);
	return { min: low, max: high, multiple };
}

function nullable(schema: unknown, dialect: OpenAPIDialect): boolean {
	if (!isRecord(schema)) return false;
	if (
		dialect === "3.0" &&
		schema.nullable === true &&
		typeof schema.type === "string"
	)
		return true;
	return (
		(dialect === "3.1" || dialect === "3.2") &&
		Array.isArray(schema.type) &&
		schema.type.includes("null")
	);
}

function containsCurrentRef(
	schema: unknown,
	context: RenderContext,
	depth = 0,
	refs = new Set<string>(),
	objects = new Set<object>(),
): boolean {
	context.scanNodes.value += 1;
	if (context.scanNodes.value > MAX_SCHEMA_NODES_PER_FACTORY)
		throw new SchemaRenderError(
			"FAKER_RESOURCE_BOUND_EXCEEDED",
			"Reference analysis exceeds the per-factory node limit.",
			context.path,
		);
	if (depth >= MAX_RECURSION_DEPTH + 1) return true;
	if (!isRecord(schema)) return false;
	if (objects.has(schema)) return true;
	objects.add(schema);
	if (typeof schema.$ref === "string") {
		if (context.refs.includes(schema.$ref) || refs.has(schema.$ref))
			return true;
		try {
			const target = resolveRef(context, schema.$ref);
			if (
				containsCurrentRef(
					target,
					context,
					depth + 1,
					new Set(refs).add(schema.$ref),
					new Set(objects).add(schema),
				)
			)
				return true;
		} catch {
			return false;
		}
	}
	const childObjects = new Set(objects).add(schema);
	const contains = (child: unknown) =>
		containsCurrentRef(child, context, depth + 1, refs, childObjects);
	if (isRecord(schema.properties))
		for (const child of Object.values(schema.properties))
			if (contains(child)) return true;
	if (
		isRecord(schema.additionalProperties) ||
		schema.additionalProperties === true ||
		schema.additionalProperties === false
	)
		if (contains(schema.additionalProperties)) return true;
	if (schema.items !== undefined && contains(schema.items)) return true;
	if (Array.isArray(schema.prefixItems))
		for (const child of schema.prefixItems) if (contains(child)) return true;
	for (const keyword of ["allOf", "anyOf", "oneOf"] as const)
		if (Array.isArray(schema[keyword]))
			for (const child of schema[keyword] as unknown[])
				if (contains(child)) return true;
	return false;
}

function escapeExpression(value: unknown): string {
	return JSON.stringify(value);
}

function render(
	schemaInput: unknown,
	context: RenderContext,
	refDepth = 0,
): string {
	context.nodes.value += 1;
	if (context.nodes.value > MAX_SCHEMA_NODES_PER_FACTORY)
		throw new SchemaRenderError(
			"FAKER_RESOURCE_BOUND_EXCEEDED",
			"The schema exceeds the per-factory node limit.",
			context.path,
		);
	if (schemaInput === true) return "null";
	if (schemaInput === false)
		throw new SchemaRenderError(
			"FAKER_UNSATISFIABLE_CONSTRAINT",
			"The false schema has no valid value.",
			context.path,
		);
	if (!isRecord(schemaInput))
		throw new SchemaRenderError(
			"FAKER_UNSUPPORTED_SCHEMA",
			"The schema form is not supported.",
			context.path,
		);
	const schema = schemaInput;
	if (
		(Array.isArray(schema.enum) &&
			schema.enum.length > MAX_SCHEMA_NODES_PER_FACTORY) ||
		(Array.isArray(schema.examples) &&
			schema.examples.length > MAX_SCHEMA_NODES_PER_FACTORY) ||
		(isRecord(schema.properties) &&
			Object.keys(schema.properties).length > MAX_SCHEMA_NODES_PER_FACTORY) ||
		(Array.isArray(schema.required) &&
			schema.required.length > MAX_SCHEMA_NODES_PER_FACTORY)
	) {
		throw new SchemaRenderError(
			"FAKER_RESOURCE_BOUND_EXCEEDED",
			"The schema collection exceeds the maintained per-factory item limit.",
			context.path,
		);
	}
	const unsupported = hasUnsupportedValidation(schema);
	if (unsupported)
		throw new SchemaRenderError(
			"FAKER_UNSUPPORTED_SCHEMA",
			`The schema keyword ${unsupported} is not supported.`,
			[...context.path, unsupported],
		);
	if (schema.format === "byte" || schema.format === "binary")
		throw new SchemaRenderError(
			"FAKER_UNSUPPORTED_FORMAT",
			`The ${schema.format} format is not supported.`,
			context.path,
		);
	if (typeof schema.$ref === "string") {
		const ref = schema.$ref;
		if (context.refs.includes(ref)) {
			const validationSiblings = Object.keys(schema).filter(
				(key) => !referenceAnnotationKeys.has(key),
			);
			if (validationSiblings.length > 0)
				throw new SchemaRenderError(
					"FAKER_UNSUPPORTED_COMPOSITION",
					"Validation keywords alongside a local $ref are not supported unless materialized into the referenced schema.",
					context.path,
				);
			if (nullable(resolveRef(context, ref), context.dialect)) return "null";
			throw new SchemaRenderError(
				"FAKER_UNBOUNDED_RECURSION",
				"The recursive schema has no supported finite termination at this location.",
				context.path,
			);
		}
		if (refDepth >= MAX_RECURSION_DEPTH)
			throw new SchemaRenderError(
				"FAKER_UNBOUNDED_RECURSION",
				"The reference depth exceeds the maintained recursion limit.",
				context.path,
			);
		context.refs.push(ref);
		try {
			const target = resolveRef(context, ref);
			const validationSiblings = Object.keys(schema).filter(
				(key) => !referenceAnnotationKeys.has(key),
			);
			if (validationSiblings.length > 0)
				throw new SchemaRenderError(
					"FAKER_UNSUPPORTED_COMPOSITION",
					"Validation keywords alongside a local $ref are not supported unless materialized into the referenced schema.",
					context.path,
				);
			if (isRecord(target)) {
				const candidates = Object.fromEntries(
					Object.entries(schema).filter(([key]) =>
						["example", "examples", "default"].includes(key),
					),
				);
				return render({ ...target, ...candidates }, context, refDepth + 1);
			}
			return render(target, context, refDepth + 1);
		} finally {
			context.refs.pop();
		}
	}
	if (Array.isArray(schema.allOf)) {
		ensureCompositionHasNoValidationSiblings(schema, "allOf", context.path);
		if (schema.allOf.length > MAX_COMPOSITION_BRANCHES)
			throw new SchemaRenderError(
				"FAKER_RESOURCE_BOUND_EXCEEDED",
				"The schema exceeds the composition branch limit.",
				context.path,
			);
		const branches = schema.allOf;
		const first = branches[0];
		if (branches.length === 0)
			throw new SchemaRenderError(
				"FAKER_UNSUPPORTED_COMPOSITION",
				"An empty allOf has no supported value type.",
				context.path,
			);
		if (
			branches.every(
				(branch) => JSON.stringify(branch) === JSON.stringify(first),
			)
		)
			return render(first, context, refDepth);
		if (
			branches.every(
				(branch) =>
					isRecord(branch) &&
					(getType(branch) === "object" || branch.properties !== undefined),
			)
		) {
			const properties: RecordValue = Object.create(null) as RecordValue;
			const required = new Set<string>();
			let minProperties = 0;
			let maxProperties = Number.POSITIVE_INFINITY;
			for (const branch of branches as RecordValue[]) {
				if ("const" in branch || "enum" in branch)
					throw new SchemaRenderError(
						"FAKER_UNSUPPORTED_COMPOSITION",
						"allOf object branches with const or enum constraints cannot be proven compatible.",
						context.path,
					);
				const unsupportedBranchKeyword = hasUnsupportedValidation(branch);
				if (unsupportedBranchKeyword)
					throw new SchemaRenderError(
						"FAKER_UNSUPPORTED_COMPOSITION",
						`The allOf branch uses unsupported keyword ${unsupportedBranchKeyword}.`,
						context.path,
					);
				if (
					branch.additionalProperties !== undefined &&
					branch.additionalProperties !== true
				)
					throw new SchemaRenderError(
						"FAKER_UNSUPPORTED_COMPOSITION",
						"allOf branches with constrained additionalProperties cannot be proven compatible.",
						context.path,
					);
				if (isRecord(branch.properties)) {
					for (const [name, propertySchema] of Object.entries(
						branch.properties,
					)) {
						if (
							Object.hasOwn(properties, name) &&
							JSON.stringify(properties[name]) !==
								JSON.stringify(propertySchema)
						)
							throw new SchemaRenderError(
								"FAKER_UNSUPPORTED_COMPOSITION",
								"allOf branches define incompatible schemas for the same property.",
								[...context.path, "properties", name],
							);
						properties[name] = propertySchema;
					}
				}
				if (Array.isArray(branch.required))
					for (const name of branch.required)
						if (typeof name === "string") required.add(name);
				if (typeof branch.minProperties === "number")
					minProperties = Math.max(minProperties, branch.minProperties);
				if (typeof branch.maxProperties === "number")
					maxProperties = Math.min(maxProperties, branch.maxProperties);
			}
			return render(
				{
					type: "object",
					properties,
					required: [...required],
					minProperties,
					...(Number.isFinite(maxProperties) ? { maxProperties } : {}),
				},
				context,
				refDepth,
			);
		}
		throw new SchemaRenderError(
			"FAKER_UNSUPPORTED_COMPOSITION",
			"The allOf branches cannot be proven compatible in v1.",
			context.path,
		);
	}
	if (Array.isArray(schema.anyOf)) {
		ensureCompositionHasNoValidationSiblings(schema, "anyOf", context.path);
		if (schema.anyOf.length > MAX_COMPOSITION_BRANCHES)
			throw new SchemaRenderError(
				"FAKER_RESOURCE_BOUND_EXCEEDED",
				"The schema exceeds the composition branch limit.",
				context.path,
			);
		for (let index = 0; index < schema.anyOf.length; index += 1) {
			const branchDiagnostics: FakerDiagnostic[] = [];
			try {
				const expression = render(
					schema.anyOf[index],
					{
						...context,
						path: [...context.path, "anyOf", index],
						diagnostics: branchDiagnostics,
					},
					refDepth,
				);
				context.diagnostics.push(...branchDiagnostics);
				return expression;
			} catch (error) {
				if (
					error instanceof SchemaRenderError &&
					error.code === "FAKER_RESOURCE_BOUND_EXCEEDED"
				)
					throw error;
			}
		}
		throw new SchemaRenderError(
			"FAKER_UNSUPPORTED_COMPOSITION",
			"No anyOf branch has a supported value.",
			context.path,
		);
	}
	if (Array.isArray(schema.oneOf)) {
		ensureCompositionHasNoValidationSiblings(schema, "oneOf", context.path);
		if (schema.oneOf.length > MAX_COMPOSITION_BRANCHES)
			throw new SchemaRenderError(
				"FAKER_RESOURCE_BOUND_EXCEEDED",
				"The schema exceeds the composition branch limit.",
				context.path,
			);
		const branches = schema.oneOf.filter(isRecord);
		if (
			branches.length !== schema.oneOf.length ||
			branches.length < 2 ||
			branches.some((branch, index) =>
				branches
					.slice(index + 1)
					.some((other) => !provablyExclusive(branch, other, context.dialect)),
			)
		)
			throw new SchemaRenderError(
				"FAKER_UNSUPPORTED_COMPOSITION",
				"The oneOf branches cannot be proven mutually exclusive.",
				context.path,
			);
		return render(
			schema.oneOf[0],
			{ ...context, path: [...context.path, "oneOf", 0] },
			refDepth,
		);
	}
	const literal = literalCandidate(schema, context);
	if (literal !== undefined) return literal;
	const type = getType(schema);
	if (!type)
		throw new SchemaRenderError(
			"FAKER_UNSUPPORTED_SCHEMA",
			"The schema does not declare a supported value type.",
			context.path,
		);
	if (type === "null") return "null";
	if (type === "boolean") return "faker.datatype.boolean()";
	if (type === "integer" || type === "number") {
		const integer =
			type === "integer" ||
			schema.format === "int32" ||
			schema.format === "int64";
		const format = schema.format;
		let lower = integer ? Number.MIN_SAFE_INTEGER : -1_000_000;
		let upper = integer ? Number.MAX_SAFE_INTEGER : 1_000_000;
		if (format === "int32") {
			lower = -2_147_483_648;
			upper = 2_147_483_647;
		}
		const boundedSchema = {
			...schema,
			minimum:
				typeof schema.minimum === "number"
					? Math.max(schema.minimum, lower)
					: lower,
			maximum:
				typeof schema.maximum === "number"
					? Math.min(schema.maximum, upper)
					: upper,
		};
		if (integer) {
			const bounds = finiteMultipleBounds(boundedSchema, true);
			const call = `faker.number.int({ min: ${bounds.min}, max: ${bounds.max} })`;
			return bounds.multiple === undefined
				? call
				: `(${call} * ${bounds.multiple})`;
		}
		if (typeof schema.multipleOf === "number") {
			const bounds = floatMultipleBounds(boundedSchema);
			return `(faker.number.int({ min: ${bounds.min}, max: ${bounds.max} }) * ${bounds.multipleNumerator} / ${bounds.multipleDenominator})`;
		}
		const bounds = numberBounds(boundedSchema, false);
		return `faker.number.float({ min: ${bounds.min}, max: ${bounds.max} })`;
	}
	if (type === "string") {
		if (
			(typeof schema.minLength === "number" && schema.minLength < 0) ||
			(typeof schema.maxLength === "number" && schema.maxLength < 0)
		)
			throw new SchemaRenderError(
				"FAKER_UNSATISFIABLE_CONSTRAINT",
				"String length constraints must be non-negative.",
				context.path,
			);
		if (
			typeof schema.minLength === "number" &&
			schema.minLength > MAX_SYNTHETIC_STRING_LENGTH
		)
			throw new SchemaRenderError(
				"FAKER_RESOURCE_BOUND_EXCEEDED",
				"minLength exceeds the maintained synthetic string limit.",
				context.path,
			);
		const min = typeof schema.minLength === "number" ? schema.minLength : 0;
		const max =
			typeof schema.maxLength === "number"
				? Math.min(schema.maxLength, MAX_SYNTHETIC_STRING_LENGTH)
				: MAX_SYNTHETIC_STRING_LENGTH;
		if (min > max)
			throw new SchemaRenderError(
				"FAKER_UNSATISFIABLE_CONSTRAINT",
				"The string length constraints have no supported value.",
				context.path,
			);
		const length = Math.max(min, Math.min(8, max));
		const format = schema.format;
		if (typeof format === "string") {
			switch (format) {
				case "email":
				case "uuid":
				case "uri":
				case "url":
				case "hostname":
				case "ipv4":
				case "ipv6":
				case "date":
				case "date-time":
				case "time":
				case "duration":
					if (schema.minLength !== undefined || schema.maxLength !== undefined)
						throw new SchemaRenderError(
							"FAKER_UNSUPPORTED_SCHEMA",
							`String length constraints combined with format ${format} are not supported.`,
							context.path,
						);
					switch (format) {
						case "email":
							return "faker.internet.exampleEmail()";
						case "uuid":
							return "faker.string.uuid({ version: 4 })";
						case "uri":
						case "url":
							return "faker.internet.url()";
						case "hostname":
							return "faker.internet.domainName()";
						case "ipv4":
							return "faker.internet.ipv4()";
						case "ipv6":
							return "faker.internet.ipv6()";
						case "date":
							return 'faker.date.between({ from: "2000-01-01T00:00:00.000Z", to: "2030-12-31T23:59:59.999Z" }).toISOString().slice(0, 10)';
						case "date-time":
							return 'faker.date.between({ from: "2000-01-01T00:00:00.000Z", to: "2030-12-31T23:59:59.999Z" }).toISOString()';
						case "time":
							return '(faker.number.int({ min: 0, max: 23 }).toString().padStart(2, "0") + ":" + faker.number.int({ min: 0, max: 59 }).toString().padStart(2, "0") + ":" + faker.number.int({ min: 0, max: 59 }).toString().padStart(2, "0") + "Z")';
						case "duration":
							return '"P1D"';
					}
					break;
				case "password":
					break;
				case "byte":
				case "binary":
					throw new SchemaRenderError(
						"FAKER_UNSUPPORTED_FORMAT",
						`The ${format} format is not supported.`,
						context.path,
					);
				default:
					context.diagnostics.push({
						code: "FAKER_FORMAT_FALLBACK",
						severity: "warning",
						message: `The custom string format ${format.slice(0, 48)} uses the generic bounded string fallback.`,
						path: context.path,
					});
			}
		}
		return `faker.string.alphanumeric({ length: ${length} })`;
	}
	if (type === "array") {
		const minItems = typeof schema.minItems === "number" ? schema.minItems : 0;
		const maxItems =
			typeof schema.maxItems === "number" ? schema.maxItems : MAX_ARRAY_ITEMS;
		if (minItems > MAX_ARRAY_ITEMS)
			throw new SchemaRenderError(
				"FAKER_RESOURCE_BOUND_EXCEEDED",
				"minItems exceeds the maintained array limit.",
				context.path,
			);
		if (minItems < 0 || maxItems < 0 || minItems > maxItems)
			throw new SchemaRenderError(
				"FAKER_UNSATISFIABLE_CONSTRAINT",
				"Array item-count constraints have no valid length.",
				context.path,
			);
		const count = Math.max(minItems, Math.min(2, maxItems, MAX_ARRAY_ITEMS));
		if (count < minItems)
			throw new SchemaRenderError(
				"FAKER_UNSATISFIABLE_CONSTRAINT",
				"The array item constraints have no supported value.",
				context.path,
			);
		const items = schema.prefixItems;
		if (
			minItems === 0 &&
			count > 0 &&
			(Array.isArray(items)
				? items
						.slice(0, count)
						.some((item) => containsCurrentRef(item, context))
				: containsCurrentRef(schema.items ?? true, context))
		)
			return "[]";
		if (Array.isArray(items)) {
			if (items.length > MAX_ARRAY_ITEMS)
				throw new SchemaRenderError(
					"FAKER_RESOURCE_BOUND_EXCEEDED",
					"The tuple exceeds the maintained array limit.",
					context.path,
				);
			if (schema.uniqueItems === true && count > 1)
				throw new SchemaRenderError(
					"FAKER_UNSUPPORTED_SCHEMA",
					"uniqueItems for tuple schemas is not supported unless the array contains at most one item.",
					context.path,
				);
			const expressions = items
				.slice(0, Math.min(items.length, count))
				.map((item, index) =>
					render(
						item,
						{ ...context, path: [...context.path, "prefixItems", index] },
						refDepth,
					),
				);
			if (count > items.length) {
				if (schema.items === false)
					throw new SchemaRenderError(
						"FAKER_UNSATISFIABLE_CONSTRAINT",
						"The array length requires items forbidden by the tuple schema.",
						context.path,
					);
				const rest = render(
					schema.items ?? true,
					{ ...context, path: [...context.path, "items"] },
					refDepth,
				);
				while (expressions.length < count) expressions.push(rest);
			}
			if (expressions.length < minItems)
				throw new SchemaRenderError(
					"FAKER_UNSATISFIABLE_CONSTRAINT",
					"The tuple cannot satisfy minItems.",
					context.path,
				);
			return `[${expressions.join(", ")}]`;
		}
		const itemSchema = schema.items ?? true;
		if (count === 0 && containsCurrentRef(itemSchema, context)) return "[]";
		if (schema.uniqueItems === true) {
			const values = isRecord(itemSchema)
				? scalarEnum(itemSchema)?.filter((value) =>
						validateLiteral(value, itemSchema, context.dialect),
					)
				: undefined;
			const distinctValues = values
				? [
						...new Map(
							values.map((value) => [JSON.stringify(value), value]),
						).values(),
					]
				: undefined;
			if (count > 1 && (!distinctValues || distinctValues.length < count))
				throw new SchemaRenderError(
					"FAKER_UNSUPPORTED_SCHEMA",
					"uniqueItems requires a finite scalar enum domain with enough distinct values.",
					context.path,
				);
			if (distinctValues && count > 1)
				return `[${distinctValues
					.slice(0, count)
					.map((value) => JSON.stringify(value))
					.join(", ")}]`;
		}
		const expression = render(
			itemSchema,
			{ ...context, path: [...context.path, "items"] },
			refDepth,
		);
		return `[${Array.from({ length: count }, () => expression).join(", ")}]`;
	}
	if (type === "object") {
		const properties = isRecord(schema.properties) ? schema.properties : {};
		const names = Object.keys(properties).sort(compare);
		const requiredNames = [
			...new Set(
				Array.isArray(schema.required)
					? schema.required.filter(
							(item): item is string => typeof item === "string",
						)
					: [],
			),
		].sort(compare);
		const required = new Set(requiredNames);
		const optionalNames = names.filter((name) => !required.has(name));
		const additionalProperties = schema.additionalProperties;
		const unknownRequired = requiredNames.filter(
			(name) => !Object.hasOwn(properties, name),
		);
		if (unknownRequired.length > 0 && additionalProperties === false)
			throw new SchemaRenderError(
				"FAKER_UNSATISFIABLE_CONSTRAINT",
				"A required property is forbidden by additionalProperties.",
				context.path,
			);
		const maxProperties =
			typeof schema.maxProperties === "number"
				? schema.maxProperties
				: names.length + unknownRequired.length;
		const minProperties =
			typeof schema.minProperties === "number" ? schema.minProperties : 0;
		if (
			minProperties < 0 ||
			maxProperties < 0 ||
			requiredNames.length > maxProperties
		)
			throw new SchemaRenderError(
				"FAKER_UNSATISFIABLE_CONSTRAINT",
				"Required object properties exceed maxProperties or property-count constraints are invalid.",
				context.path,
			);
		if (
			minProperties >
			Math.min(names.length + unknownRequired.length, maxProperties)
		) {
			if (additionalProperties === false)
				throw new SchemaRenderError(
					"FAKER_UNSATISFIABLE_CONSTRAINT",
					"The object property count constraints cannot be met by declared properties.",
					context.path,
				);
			throw new SchemaRenderError(
				"FAKER_UNSUPPORTED_SCHEMA",
				"minProperties cannot be met without inventing additional property names.",
				context.path,
			);
		}
		const finiteOptionalNames = optionalNames.filter(
			(name) =>
				!containsCurrentRef(properties[name], context) ||
				nullable(properties[name], context.dialect),
		);
		const chosen = [
			...requiredNames,
			...finiteOptionalNames.slice(
				0,
				Math.max(0, maxProperties - requiredNames.length),
			),
		];
		const entries: string[] = [];
		for (const name of chosen.sort(compare)) {
			const declared = Object.hasOwn(properties, name);
			const propertySchema = declared
				? properties[name]
				: isRecord(additionalProperties)
					? additionalProperties
					: true;
			const propertyPath = [...context.path, "properties", name];
			const expression = render(
				propertySchema,
				{ ...context, path: propertyPath },
				refDepth,
			);
			const key =
				name === "__proto__"
					? `[${escapeExpression(name)}]`
					: escapeExpression(name);
			entries.push(`${key}: ${expression}`);
		}
		if (entries.length < minProperties)
			throw new SchemaRenderError(
				"FAKER_UNSUPPORTED_SCHEMA",
				"minProperties cannot be met without inventing additional property names.",
				context.path,
			);
		if (
			schema.additionalProperties === false &&
			names.length === 0 &&
			minProperties > 0
		)
			throw new SchemaRenderError(
				"FAKER_UNSATISFIABLE_CONSTRAINT",
				"The object has no declared property available to satisfy minProperties.",
				context.path,
			);
		return `{ ${entries.join(", ")} }`;
	}
	throw new SchemaRenderError(
		"FAKER_UNSUPPORTED_SCHEMA",
		`The schema type ${type} is not supported.`,
		context.path,
	);
}

export function renderSchema(
	schema: Schema | unknown,
	document: unknown,
	path: Array<string | number>,
): { expression: string; diagnostics: FakerDiagnostic[] } {
	const diagnostics: FakerDiagnostic[] = [];
	const dialect = isRecord(document)
		? classifyOpenAPIDialect(document.openapi)
		: "unknown";
	try {
		return {
			expression: render(schema, {
				document,
				dialect,
				path,
				diagnostics,
				nodes: { value: 0 },
				scanNodes: { value: 0 },
				refs: [],
			}),
			diagnostics,
		};
	} catch (error) {
		if (error instanceof SchemaRenderError && error.path.length === 0)
			error.path.push(...path);
		throw error;
	}
}
