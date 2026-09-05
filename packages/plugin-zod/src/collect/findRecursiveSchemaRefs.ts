import type { ComponentsSchemas, Schema } from "@openapi-to/core";
import { collectRefsFromSchema } from "./collectRefsFromSchemas.ts";

const schemaRefPrefix = "#/components/schemas/";

function schemaNameFromRef(ref: string): string | undefined {
	return ref.startsWith(schemaRefPrefix)
		? decodeURIComponent(ref.slice(schemaRefPrefix.length))
		: undefined;
}

export function findRecursiveSchemaRefs(
	schemas: ComponentsSchemas,
): Set<string> {
	const names = Object.keys(schemas);
	const known = new Set(names);
	const graph = new Map(
		names.map((name) => [
			name,
			schemas[name]
				? collectRefsFromSchema(schemas[name])
						.map(schemaNameFromRef)
						.filter((ref): ref is string => ref !== undefined && known.has(ref))
				: [],
		]),
	);

	return recursiveRefsFromGraph(graph);
}

type SchemaRecord = Record<string, unknown>;

function isRecord(value: unknown): value is SchemaRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectUnguardedRefs(schema: Schema): string[] {
	if (!isRecord(schema)) return [];
	const record: SchemaRecord = schema;
	const refs = typeof record.$ref === "string" ? [record.$ref] : [];
	for (const keyword of ["oneOf", "anyOf", "allOf"] as const) {
		const members = record[keyword];
		if (Array.isArray(members)) {
			for (const member of members) {
				refs.push(...collectUnguardedRefs(member as Schema));
			}
		}
	}
	return refs;
}

export function findUnguardedRecursiveSchemaRefs(
	schemas: ComponentsSchemas,
): Set<string> {
	const names = Object.keys(schemas);
	const known = new Set(names);
	const graph = new Map(
		names.map((name) => [
			name,
			schemas[name]
				? collectUnguardedRefs(schemas[name])
						.map(schemaNameFromRef)
						.filter((ref): ref is string => ref !== undefined && known.has(ref))
				: [],
		]),
	);
	return recursiveRefsFromGraph(graph);
}

function recursiveRefsFromGraph(graph: Map<string, string[]>): Set<string> {
	const names = [...graph.keys()];
	let nextIndex = 0;
	const indexes = new Map<string, number>();
	const lowLinks = new Map<string, number>();
	const stack: string[] = [];
	const onStack = new Set<string>();
	const recursiveNames = new Set<string>();

	function visit(name: string) {
		indexes.set(name, nextIndex);
		lowLinks.set(name, nextIndex);
		nextIndex += 1;
		stack.push(name);
		onStack.add(name);

		for (const dependency of graph.get(name) ?? []) {
			if (!indexes.has(dependency)) {
				visit(dependency);
				lowLinks.set(
					name,
					Math.min(lowLinks.get(name) ?? 0, lowLinks.get(dependency) ?? 0),
				);
			} else if (onStack.has(dependency)) {
				lowLinks.set(
					name,
					Math.min(lowLinks.get(name) ?? 0, indexes.get(dependency) ?? 0),
				);
			}
		}

		if (lowLinks.get(name) !== indexes.get(name)) return;
		const component: string[] = [];
		while (stack.length > 0) {
			const member = stack.pop();
			if (!member) break;
			onStack.delete(member);
			component.push(member);
			if (member === name) break;
		}
		if (component.length > 1 || (graph.get(name) ?? []).includes(name)) {
			component.forEach((member) => {
				recursiveNames.add(member);
			});
		}
	}

	names.forEach((name) => {
		if (!indexes.has(name)) visit(name);
	});
	return new Set(
		[...recursiveNames].map((name) => `${schemaRefPrefix}${name}`),
	);
}
