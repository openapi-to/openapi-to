import {
	hasActiveSchemaRefSiblings,
	type OpenAPIRefSemanticContext,
	type Schema,
} from "@openapi-to/core";
import { getComponentRefExportName } from "@/utils/componentNaming.ts";
import {
	hasInt64SafeIntegerBoundary,
	int64SafeIntegerDiagnosticMessage,
} from "@/validation/int64SafeInteger.ts";
import {
	findUnsupportedValidationKeywords,
	unsupportedValidationKeywordDiagnosticMessage,
} from "@/validation/unsupportedValidationKeywords.ts";

type SchemaRecord = Record<string, unknown>;

export type SchemaRenderDiagnostic = {
	code:
		| "ZOD_EMPTY_COMPOSITION"
		| "ZOD_EMPTY_ENUM"
		| "ZOD_UNSUPPORTED_SCHEMA_SIBLINGS"
		| "ZOD_UNSUPPORTED_ENUM_VALUE"
		| "ZOD_UNSUPPORTED_VALIDATION_KEYWORD"
		| "ZOD_INT64_SAFE_INTEGER_ONLY"
		| "ZOD_RESPONSE_HEADER_NAME_COLLISION"
		| "ZOD_RESPONSE_HEADER_REFERENCE_UNRESOLVED"
		| "ZOD_MULTIPLE_MEDIA_TYPES_UNSUPPORTED"
		| "ZOD_INVALID_CONTENT_CARDINALITY"
		| "ZOD_UNSUPPORTED_REQUIRED_WITHOUT_OBJECT_CONTEXT";
	message: string;
};

export type SchemaRenderOptions = {
	refSemanticContext?: OpenAPIRefSemanticContext;
	lazyRefs?: ReadonlySet<string>;
	unguardedRecursiveRefs?: ReadonlySet<string>;
	exactOneBranch?: boolean;
	structuralGuard?: boolean;
	onDiagnostic?: (diagnostic: SchemaRenderDiagnostic) => void;
};

function isRecord(value: unknown): value is SchemaRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reportDiagnostic(
	options: SchemaRenderOptions,
	diagnostic: SchemaRenderDiagnostic,
): void {
	if (options.onDiagnostic) {
		options.onDiagnostic(diagnostic);
		return;
	}
	throw new Error(`${diagnostic.code}: ${diagnostic.message}`);
}

function literal(value: unknown): string | undefined {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean" ||
		(typeof value === "number" && Number.isFinite(value))
	) {
		return `z.literal(${JSON.stringify(value)})`;
	}
	return undefined;
}

function enumSchema(values: unknown[], options: SchemaRenderOptions): string {
	const uniqueValues = values.filter(
		(value, index) =>
			values.findIndex((candidate) => Object.is(candidate, value)) === index,
	);
	if (uniqueValues.length === 0) {
		reportDiagnostic(options, {
			code: "ZOD_EMPTY_ENUM",
			message: "An empty enum cannot match any value; generated z.never().",
		});
		return "z.never()";
	}

	const literals = uniqueValues.map(literal);
	if (literals.some((value) => value === undefined)) {
		reportDiagnostic(options, {
			code: "ZOD_UNSUPPORTED_ENUM_VALUE",
			message:
				"An enum contains a non-JSON scalar value that cannot be represented as a Zod literal; generated z.never().",
		});
		return "z.never()";
	}
	if (literals.length === 1) return literals[0] ?? "z.never()";
	if (uniqueValues.every((value) => typeof value === "string")) {
		return `z.enum([${uniqueValues.map((value) => JSON.stringify(value)).join(", ")}])`;
	}
	return `z.union([${literals.join(", ")}])`;
}

function unionSchema(
	schemas: unknown[],
	propertyName: string,
	parentName: string,
	options: SchemaRenderOptions,
): string {
	if (schemas.length === 0) {
		reportDiagnostic(options, {
			code: "ZOD_EMPTY_COMPOSITION",
			message: `An empty union${propertyName ? ` at "${propertyName}"` : ""} cannot match any value; generated z.never().`,
		});
		return "z.never()";
	}
	const members = schemas.map((schema) =>
		renderSchema(schema as Schema, propertyName, parentName, options),
	);
	return members.length === 1
		? (members[0] ?? "z.never()")
		: `z.union([${members.join(", ")}])`;
}

function exactOneSchema(
	schemas: unknown[],
	propertyName: string,
	parentName: string,
	options: SchemaRenderOptions,
): string {
	if (schemas.length === 0) {
		reportDiagnostic(options, {
			code: "ZOD_EMPTY_COMPOSITION",
			message: `An empty oneOf${propertyName ? ` at "${propertyName}"` : ""} cannot match any value; generated z.never().`,
		});
		return "z.never()";
	}
	const members = schemas.map((schema) =>
		renderSchema(schema as Schema, propertyName, parentName, {
			...options,
			exactOneBranch: true,
			structuralGuard: options.exactOneBranch ? options.structuralGuard : false,
		}),
	);
	if (members.length === 1) return members[0] ?? "z.never()";
	return `z.xor([${members.join(", ")}])`;
}

function intersectionSchema(
	schemas: unknown[],
	propertyName: string,
	parentName: string,
	options: SchemaRenderOptions,
): string {
	if (schemas.length === 0) {
		reportDiagnostic(options, {
			code: "ZOD_EMPTY_COMPOSITION",
			message: `An empty intersection${propertyName ? ` at "${propertyName}"` : ""} cannot be represented safely; generated z.never().`,
		});
		return "z.never()";
	}
	const members = schemas.map((schema) =>
		renderSchema(schema as Schema, propertyName, parentName, options),
	);
	return members
		.slice(1)
		.reduce(
			(left, right) => `z.intersection(${left}, ${right})`,
			members[0] ?? "z.never()",
		);
}

function appendStringConstraints(
	expression: string,
	schema: SchemaRecord,
): string {
	let result = expression;
	if (typeof schema.minLength === "number")
		result += `.min(${schema.minLength})`;
	if (typeof schema.maxLength === "number")
		result += `.max(${schema.maxLength})`;
	if (typeof schema.pattern === "string")
		result += `.regex(new RegExp(${JSON.stringify(schema.pattern)}))`;
	return result;
}

function dateTimeSchema(schema: SchemaRecord): string {
	const constrainedString = appendStringConstraints("z.string()", schema);
	return `(() => { const dateTime = z.iso.datetime({ offset: true }).regex(/T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$/); const leapSecond = /^(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}):60(?:\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})$/; return ${constrainedString}.refine((value) => { if (dateTime.safeParse(value).success) return true; const match = leapSecond.exec(value); if (!match) return false; const surrogate = \`\${match[1]}:59\${match[2]}\`; if (!dateTime.safeParse(surrogate).success) return false; const instant = Date.parse(surrogate); if (!Number.isFinite(instant)) return false; const utc = new Date(instant + 1000); return utc.getUTCDate() === 1 && utc.getUTCHours() === 0 && utc.getUTCMinutes() === 0 && utc.getUTCSeconds() === 0; }); })()`;
}

function formatterString(schema: SchemaRecord): string {
	let expression: string;
	switch (schema.format) {
		case "email":
			expression = "z.email()";
			break;
		case "uri":
		case "url":
			expression = "z.url()";
			break;
		case "uuid":
			expression = "z.uuid()";
			break;
		case "date":
			expression = "z.iso.date()";
			break;
		case "date-time":
		case "datetime":
			return dateTimeSchema(schema);
		case "byte":
			expression = "z.base64()";
			break;
		case "password":
			expression = "z.string()";
			break;
		default:
			expression = "z.string()";
			break;
	}
	return appendStringConstraints(expression, schema);
}

function formatterNumber(schema: SchemaRecord): string {
	const integerFormats = new Set(["int32", "int64", "integer", "long", "int"]);
	let result =
		schema.type === "integer" || integerFormats.has(String(schema.format ?? ""))
			? "z.int()"
			: "z.number()";

	if (schema.format === "int32") {
		result += ".min(-2147483648).max(2147483647)";
	}

	if (typeof schema.minimum === "number") {
		result +=
			schema.exclusiveMinimum === true
				? `.gt(${schema.minimum})`
				: `.min(${schema.minimum})`;
	} else if (typeof schema.exclusiveMinimum === "number") {
		result += `.gt(${schema.exclusiveMinimum})`;
	}
	if (typeof schema.maximum === "number") {
		result +=
			schema.exclusiveMaximum === true
				? `.lt(${schema.maximum})`
				: `.max(${schema.maximum})`;
	} else if (typeof schema.exclusiveMaximum === "number") {
		result += `.lt(${schema.exclusiveMaximum})`;
	}
	if (typeof schema.multipleOf === "number")
		result += `.multipleOf(${schema.multipleOf})`;
	return result;
}

function refSchema(ref: string, options: SchemaRenderOptions): string {
	if (
		options.exactOneBranch &&
		!options.structuralGuard &&
		options.unguardedRecursiveRefs?.has(ref)
	)
		return "z.never()";
	const alias = getComponentRefExportName(ref);
	return options.lazyRefs?.has(ref) ? `z.lazy(() => ${alias})` : alias;
}

const validationKeywords = new Set([
	"$ref",
	"enum",
	"const",
	"oneOf",
	"anyOf",
	"allOf",
	"type",
	"format",
	"minLength",
	"maxLength",
	"pattern",
	"minimum",
	"maximum",
	"exclusiveMinimum",
	"exclusiveMaximum",
	"multipleOf",
	"items",
	"minItems",
	"maxItems",
	"properties",
	"required",
	"additionalProperties",
]);

function renderSiblingConstraints(
	schema: SchemaRecord,
	primaryKeyword: "$ref" | "enum" | "const" | "oneOf" | "anyOf" | "allOf",
	propertyName: string,
	parentName: string,
	options: SchemaRenderOptions,
): string | undefined {
	const sibling = { ...schema };
	delete sibling[primaryKeyword];
	delete sibling.nullable;
	if (
		primaryKeyword === "allOf" &&
		sibling.additionalProperties !== undefined &&
		sibling.properties === undefined
	) {
		reportDiagnostic(options, {
			code: "ZOD_UNSUPPORTED_SCHEMA_SIBLINGS",
			message:
				"allOf with sibling additionalProperties cannot be represented exactly by the current Zod renderer; the sibling keyword was not applied.",
		});
		delete sibling.additionalProperties;
	}
	const keys = Object.keys(sibling).filter((key) =>
		validationKeywords.has(key),
	);
	if (keys.length === 0) return undefined;
	if (
		keys.some((key) =>
			["$ref", "enum", "const", "oneOf", "anyOf", "allOf"].includes(key),
		)
	) {
		return renderSchema(sibling as Schema, propertyName, parentName, options);
	}

	if (
		sibling.type === undefined &&
		keys.some((key) =>
			["format", "minLength", "maxLength", "pattern"].includes(key),
		)
	) {
		sibling.type = "string";
	}
	if (
		sibling.type === undefined &&
		keys.some((key) =>
			[
				"minimum",
				"maximum",
				"exclusiveMinimum",
				"exclusiveMaximum",
				"multipleOf",
			].includes(key),
		)
	) {
		sibling.type = "number";
	}
	if (
		sibling.type === undefined &&
		keys.some((key) => ["items", "minItems", "maxItems"].includes(key))
	) {
		sibling.type = "array";
	}
	if (
		sibling.type === undefined &&
		keys.some((key) =>
			["properties", "required", "additionalProperties"].includes(key),
		)
	) {
		sibling.type = "object";
	}

	const rendered =
		resolveTypeArray(sibling, propertyName, parentName, options) ??
		resolveBaseSchema(sibling as Schema, propertyName, parentName, options);
	return rendered === "z.unknown()" ? undefined : rendered;
}

function arraySchema(
	schema: SchemaRecord,
	propertyName: string,
	parentName: string,
	options: SchemaRenderOptions,
): string {
	const items = schema.items;
	let result = `z.array(${items === undefined ? "z.unknown()" : renderSchema(items as Schema, propertyName, parentName, { ...options, structuralGuard: options.exactOneBranch || options.structuralGuard })})`;
	if (typeof schema.minItems === "number") result += `.min(${schema.minItems})`;
	if (typeof schema.maxItems === "number") result += `.max(${schema.maxItems})`;
	return result;
}

function appendRequiredPropertyPresence(
	objectExpression: string,
	required: ReadonlySet<string>,
): string {
	const keys = [...required].sort((left, right) =>
		left < right ? -1 : left > right ? 1 : 0,
	);
	if (keys.length === 0) return objectExpression;
	const protoKey = `Symbol.for("openapi-to.required-proto.v1")`;
	const inputPreparation = protoKey
		? `if (hasProtoKey && input !== null && typeof input === "object" && Object.prototype.hasOwnProperty.call(input, "__proto__")) { const copy = { ...Object(input) }; Object.defineProperty(copy, protoKey, { value: Object(input)["__proto__"], enumerable: true, configurable: true, writable: true }); delete copy["__proto__"]; return copy; } return input;`
		: "return input;";
	const parserExpression = protoKey
		? objectExpression.replace('["__proto__"]:', "[protoKey]:")
		: objectExpression;
	const objectMethods = [
		"keyof",
		"catchall",
		"passthrough",
		"loose",
		"strict",
		"strip",
		"extend",
		"safeExtend",
		"merge",
		"pick",
		"omit",
		"partial",
		"required",
	]
		.map((method) => `${method}: objectSchema.${method}.bind(objectSchema)`)
		.join(", ");
	return `((protoKey: symbol) => {
	const wrapperMetadataKey = Symbol.for("openapi-to.required-object-wrapper.v1");
	function wrapObject<T extends z.ZodObject>(objectSchema: T, requiredKeys: string[]): T {
		const objectShape = objectSchema.shape as Record<PropertyKey, any>;
		const hasProtoKey = Object.prototype.hasOwnProperty.call(objectShape, protoKey);
		const checked = z.preprocess((input, ctx) => {
			if (input !== null && typeof input === "object") {
				for (const key of requiredKeys) {
					if (!Object.prototype.hasOwnProperty.call(input, key)) ctx.addIssue({ code: "custom", path: [key], message: "Required property is missing." });
				}
			}
			${inputPreparation}
		}, objectSchema);
		const parsed = hasProtoKey ? checked.transform((output) => {
			if (!Object.prototype.hasOwnProperty.call(output, protoKey)) return output;
			const { [protoKey]: value, ...copy } = output as Record<PropertyKey, unknown>;
			return { ...copy, ["__proto__"]: value };
		}) : checked;
		const shape = hasProtoKey
			? (() => { const { [protoKey]: propertySchema, ...rest } = objectShape; return { ...rest, ["__proto__"]: propertySchema }; })()
			: objectShape;
		function remapMask(mask: any): any {
			if (!hasProtoKey || !Object.prototype.hasOwnProperty.call(mask, "__proto__")) return mask;
			const copy = { ...Object(mask) };
			Object.defineProperty(copy, protoKey, { value: copy["__proto__"], enumerable: true, configurable: true, writable: true });
			delete copy["__proto__"];
			return copy;
		}
		function remapShape(extendedShape: any): any {
			if (!Object.prototype.hasOwnProperty.call(extendedShape, "__proto__")) return extendedShape;
			const copy = { ...Object(extendedShape) };
			Object.defineProperty(copy, protoKey, { value: copy["__proto__"], enumerable: true, configurable: true, writable: true });
			delete copy["__proto__"];
			return copy;
		}
		function displayKey(key: PropertyKey): string {
			return key === protoKey ? "__proto__" : String(key);
		}
		const declaredKeys = new Set(Reflect.ownKeys(objectSchema.shape).map(displayKey));
		function objectMethodMask(mask: any): any {
			if (mask === null || typeof mask !== "object") return mask;
			const copy = { ...Object(mask) };
			for (const key of Reflect.ownKeys(copy)) {
				const name = displayKey(key);
				if (!declaredKeys.has(name) && requiredKeys.includes(name)) delete copy[key];
			}
			return copy;
		}
		const decorated: any = Object.assign(parsed, { shape, ${objectMethods} });
		Object.defineProperty(decorated, wrapperMetadataKey, { value: { objectSchema, requiredKeys }, configurable: false, enumerable: false, writable: false });
		const originalPick = objectSchema.pick.bind(objectSchema);
		decorated.pick = function (mask: any) {
			const mappedMask = remapMask(mask);
			const picked = originalPick(objectMethodMask(mappedMask));
			return wrapObject(picked, requiredKeys.filter((key = "") => Object.prototype.hasOwnProperty.call(mappedMask, key === "__proto__" && hasProtoKey ? protoKey : key) && Object(mappedMask)[key === "__proto__" && hasProtoKey ? protoKey : key]));
		};
		const originalOmit = objectSchema.omit.bind(objectSchema);
		decorated.omit = function (mask: any) {
			const mappedMask = remapMask(mask);
			const omitted = originalOmit(objectMethodMask(mappedMask));
			return wrapObject(omitted, requiredKeys.filter((key = "") => !Object.prototype.hasOwnProperty.call(mappedMask, key === "__proto__" && hasProtoKey ? protoKey : key) || !Object(mappedMask)[key === "__proto__" && hasProtoKey ? protoKey : key]));
		};
		const originalPartial = objectSchema.partial.bind(objectSchema);
		decorated.partial = function (mask?: any) {
			const hasMask = mask !== undefined;
			const mappedMask = hasMask ? remapMask(mask) : undefined;
			const partialObject = hasMask ? originalPartial(objectMethodMask(mappedMask)) : originalPartial();
			return wrapObject(partialObject, hasMask ? requiredKeys.filter((key = "") => !Object.prototype.hasOwnProperty.call(mappedMask, key === "__proto__" && hasProtoKey ? protoKey : key) || !Object(mappedMask)[key === "__proto__" && hasProtoKey ? protoKey : key]) : []);
		};
		const originalExactPartial = (objectSchema as any).exactPartial?.bind(objectSchema);
		if (originalExactPartial) {
			Object.assign(decorated, { exactPartial: function () {
				const mask = arguments[0];
				const hasMask = mask !== undefined;
				const mappedMask = hasMask ? remapMask(mask) : undefined;
				const partialObject = hasMask ? originalExactPartial(objectMethodMask(mappedMask)) : originalExactPartial();
				return wrapObject(partialObject, hasMask ? requiredKeys.filter((key = "") => !Object.prototype.hasOwnProperty.call(mappedMask, key === "__proto__" && hasProtoKey ? protoKey : key) || !Object(mappedMask)[key === "__proto__" && hasProtoKey ? protoKey : key]) : []);
			} });
		}
		const originalExtend = objectSchema.extend.bind(objectSchema);
		decorated.extend = function (extendedShape: any) {
			const mappedShape = remapShape(extendedShape);
			return wrapObject(originalExtend(mappedShape), requiredKeys);
		};
		const originalSafeExtend = objectSchema.safeExtend.bind(objectSchema);
		decorated.safeExtend = function (extendedShape: any) {
			const mappedShape = remapShape(extendedShape);
			return wrapObject(originalSafeExtend(mappedShape), requiredKeys);
		};
		const originalMerge = objectSchema.merge.bind(objectSchema);
		decorated.merge = function (other: any) {
			const otherMetadata = other?.[wrapperMetadataKey];
			const otherObject = otherMetadata?.objectSchema ?? other;
			const otherRequiredKeys: string[] = otherMetadata?.requiredKeys ?? [];
			const otherShape = otherObject.shape as Record<PropertyKey, any>;
			const otherShapeKeys = new Set(Reflect.ownKeys(otherShape).map(displayKey));
			const nextRequiredKeys = requiredKeys.filter((key = "") => !otherShapeKeys.has(key) || otherRequiredKeys.includes(key));
			return wrapObject(originalMerge(otherObject), [...new Set([...nextRequiredKeys, ...otherRequiredKeys])]);
		};
		const originalStrict = objectSchema.strict.bind(objectSchema);
		decorated.strict = function () { return wrapObject(originalStrict(), requiredKeys); };
		const originalLoose = objectSchema.loose.bind(objectSchema);
		decorated.loose = function () { return wrapObject(originalLoose(), requiredKeys); };
		const originalPassthrough = objectSchema.passthrough.bind(objectSchema);
		decorated.passthrough = function () { return wrapObject(originalPassthrough(), requiredKeys); };
		const originalStrip = objectSchema.strip.bind(objectSchema);
		decorated.strip = function () { return wrapObject(originalStrip(), requiredKeys); };
		const originalCatchall = objectSchema.catchall.bind(objectSchema);
		decorated.catchall = function () { return wrapObject(originalCatchall(arguments[0]), requiredKeys); };
		const originalRequired = objectSchema.required.bind(objectSchema);
		decorated.required = function (mask?: any) {
			const hasMask = mask !== undefined;
			const mappedMask = hasMask ? remapMask(mask) : undefined;
			const requiredObject = hasMask ? originalRequired(objectMethodMask(mappedMask)) : originalRequired();
			const nextRequired = !hasMask
				? Reflect.ownKeys(objectSchema.shape).map(displayKey)
				: Reflect.ownKeys(Object(mappedMask)).filter((key) => Object(mappedMask)[key]).map(displayKey);
			return wrapObject(requiredObject, [...new Set([...requiredKeys, ...nextRequired])]);
		};
		if (hasProtoKey) {
			decorated.keyof = function () { return z.enum([...objectSchema.keyof().options, "__proto__"]); };
		}
		return decorated as T;
	}
	return wrapObject(${parserExpression}, ${JSON.stringify(keys)});
})(${protoKey})`;
}

export function renderObjectSchema(
	schema: SchemaRecord,
	parentName = "",
	options: SchemaRenderOptions = {},
): string {
	const properties = isRecord(schema.properties) ? schema.properties : {};
	const required = new Set(
		Array.isArray(schema.required)
			? schema.required.filter(
					(name): name is string => typeof name === "string",
				)
			: [],
	);
	const entries = Object.entries(properties);
	const shape = entries
		.map(([propertyName, propertySchema]) => {
			const rendered = renderSchema(
				propertySchema as Schema,
				propertyName,
				parentName,
				{
					...options,
					structuralGuard: options.exactOneBranch || options.structuralGuard,
				},
			);
			const propertyKey =
				propertyName === "__proto__"
					? `[${JSON.stringify(propertyName)}]`
					: JSON.stringify(propertyName);
			return `${propertyKey}: ${rendered}${required.has(propertyName) ? "" : ".optional()"}`;
		})
		.join(", ");

	if (schema.additionalProperties === false)
		return appendRequiredPropertyPresence(
			`z.strictObject({${shape}})`,
			required,
		);
	if (
		schema.additionalProperties === true ||
		schema.additionalProperties === undefined
	)
		return appendRequiredPropertyPresence(
			`z.looseObject({${shape}})`,
			required,
		);

	const additional = renderSchema(
		schema.additionalProperties as Schema,
		"",
		parentName,
		{
			...options,
			structuralGuard: options.exactOneBranch || options.structuralGuard,
		},
	);
	if (entries.length === 0) {
		if (required.size === 0) return `z.record(z.string(), ${additional})`;
		return appendRequiredPropertyPresence(
			`z.object({}).catchall(${additional})`,
			required,
		);
	}
	return appendRequiredPropertyPresence(
		`z.object({${shape}}).catchall(${additional})`,
		required,
	);
}

function resolveTypeArray(
	schema: SchemaRecord,
	propertyName: string,
	parentName: string,
	options: SchemaRenderOptions,
): string | undefined {
	if (!Array.isArray(schema.type)) return undefined;
	const members = schema.type.map((type) =>
		type === "null"
			? "z.null()"
			: resolveBaseSchema(
					{ ...schema, type } as Schema,
					propertyName,
					parentName,
					options,
				),
	);
	const unique = [...new Set(members)];
	return unique.length === 1
		? (unique[0] ?? "z.unknown()")
		: `z.union([${unique.join(", ")}])`;
}

export function schemaTemplate(
	schema: Schema,
	propertyName = "",
	parentName = "",
	options: SchemaRenderOptions = {},
): string {
	if (schema === true || schema === undefined) return "z.unknown()";
	if (schema === false) return "z.never()";
	if (!isRecord(schema)) return "z.unknown()";
	const scan = findUnsupportedValidationKeywords(schema, {
		refSemanticContext: options.refSemanticContext,
	});
	if (scan.exceededLimit || scan.keywords.length > 0) {
		reportDiagnostic(options, {
			code: "ZOD_UNSUPPORTED_VALIDATION_KEYWORD",
			message: unsupportedValidationKeywordDiagnosticMessage(scan),
		});
		return "z.never()";
	}
	if (
		hasInt64SafeIntegerBoundary(schema, {
			refSemanticContext: options.refSemanticContext,
		})
	) {
		reportDiagnostic(options, {
			code: "ZOD_INT64_SAFE_INTEGER_ONLY",
			message: int64SafeIntegerDiagnosticMessage,
		});
	}
	return renderSchema(schema, propertyName, parentName, options);
}

function hasRequiredWithoutObjectContext(
	schema: SchemaRecord,
	options: SchemaRenderOptions,
): boolean {
	if (
		typeof schema.$ref === "string" &&
		options.refSemanticContext &&
		!hasActiveSchemaRefSiblings(options.refSemanticContext)
	) {
		return false;
	}
	// An allOf made exclusively of object schemas establishes the object context
	// for its required sibling. Other compositions and refs can admit non-object
	// instances, so required-only siblings there still need the fail-closed path.
	if (
		Array.isArray(schema.allOf) &&
		schema.allOf.length > 0 &&
		schema.allOf.every(
			(branch) => isRecord(branch) && branch.type === "object",
		)
	) {
		return false;
	}
	return (
		schema.type === undefined &&
		schema.properties === undefined &&
		schema.additionalProperties === undefined &&
		Array.isArray(schema.required) &&
		schema.required.some((name) => typeof name === "string")
	);
}

function renderSchema(
	schema: Schema,
	propertyName = "",
	parentName = "",
	options: SchemaRenderOptions = {},
): string {
	if (schema === true || schema === undefined) return "z.unknown()";
	if (schema === false) return "z.never()";
	if (!isRecord(schema)) return "z.unknown()";
	const record: SchemaRecord = schema;
	if (hasRequiredWithoutObjectContext(record, options)) {
		reportDiagnostic(options, {
			code: "ZOD_UNSUPPORTED_REQUIRED_WITHOUT_OBJECT_CONTEXT",
			message:
				"A required keyword without an object rendering context cannot be represented safely; generated z.never().",
		});
		return "z.never()";
	}

	let result: string;
	let primaryKeyword:
		| "$ref"
		| "enum"
		| "const"
		| "oneOf"
		| "anyOf"
		| "allOf"
		| undefined;
	if (typeof record.$ref === "string") {
		primaryKeyword = "$ref";
		result = refSchema(record.$ref, options);
		if (
			options.refSemanticContext &&
			!hasActiveSchemaRefSiblings(options.refSemanticContext)
		) {
			return result;
		}
	} else if (Array.isArray(record.enum)) {
		primaryKeyword = "enum";
		result = enumSchema(record.enum, options);
	} else if ("const" in record) {
		primaryKeyword = "const";
		result = literal(record.const) ?? "z.never()";
	} else if (Array.isArray(record.oneOf)) {
		primaryKeyword = "oneOf";
		result = exactOneSchema(record.oneOf, propertyName, parentName, options);
	} else if (Array.isArray(record.anyOf)) {
		primaryKeyword = "anyOf";
		result = unionSchema(record.anyOf, propertyName, parentName, options);
	} else if (Array.isArray(record.allOf)) {
		primaryKeyword = "allOf";
		result = intersectionSchema(
			record.allOf,
			propertyName,
			parentName,
			options,
		);
	} else {
		result =
			resolveTypeArray(record, propertyName, parentName, options) ??
			resolveBaseSchema(schema, propertyName, parentName, options);
	}

	if (primaryKeyword) {
		const sibling = renderSiblingConstraints(
			record,
			primaryKeyword,
			propertyName,
			parentName,
			options,
		);
		if (sibling) result = `z.intersection(${result}, ${sibling})`;
	}
	if (record.nullable === true && result !== "z.null()")
		result += ".nullable()";
	return result;
}

export function resolveBaseSchema(
	schema: Schema,
	propertyName = "",
	parentName = "",
	options: SchemaRenderOptions = {},
): string {
	if (schema === true || schema === undefined) return "z.unknown()";
	if (schema === false || !isRecord(schema)) return "z.never()";
	const record: SchemaRecord = schema;

	switch (record.type) {
		case "boolean":
			return "z.boolean()";
		case "string":
			return formatterString(record);
		case "number":
		case "integer":
			return formatterNumber(record);
		case "array":
			return arraySchema(record, propertyName, parentName, options);
		case "object":
			return renderObjectSchema(record, parentName, options);
		case "null":
			return "z.null()";
		default:
			if (
				record.properties !== undefined ||
				record.additionalProperties !== undefined
			)
				return renderObjectSchema(record, parentName, options);
			return "z.unknown()";
	}
}
