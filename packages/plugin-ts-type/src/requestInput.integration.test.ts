import { PluginManager, type OpenAPIDocument } from "@openapi-to/core";
import { describe, expect, it } from "vitest";
import path from "node:path";
import { Project } from "ts-morph";
import { definePlugin } from "./plugin.ts";

describe("grouped RequestInput", () => {
	it("emits effective path/query/body requiredness, preserves standalone header/cookie types and deterministic bytes", async () => {
		const parameter = (name: string, location: string, required = false) => ({ name, in: location, required, schema: { type: "string" } });
		const body = (required: boolean) => ({ required, content: { "application/json": { schema: { type: "string" } } } });
		const cases = [
			{ id: "pathOnly", parameters: [parameter("id", "path", true)], expected: "path: PathOnlyPathParams" },
			{ id: "optionalQuery", parameters: [parameter("q", "query")], expected: "query?: OptionalQueryQueryParams" },
			{ id: "requiredQuery", parameters: [parameter("q", "query", true)], expected: "query: RequiredQueryQueryParams" },
			{ id: "optionalBody", requestBody: body(false), expected: "body?: OptionalBodyMutationRequest" },
			{ id: "requiredBody", requestBody: { $ref: "#/components/requestBodies/Required" }, expected: "body: RequiredBodyMutationRequest" },
			{ id: "allGroups", parameters: [parameter("id", "path", true), parameter("q", "query", true)], requestBody: body(true), expected: "body: AllGroupsMutationRequest" },
			{ id: "empty", parameters: [parameter("X-Dummy", "header", true), parameter("dummy", "cookie", true)], expected: "EmptyRequestInput = Record<string, never>" },
			{ id: "contentQuery", parameters: [{ name: "filter", in: "query", content: { "application/json": { schema: { type: "string" } } } }], expected: "query?: ContentQueryQueryParams" },
		];
		const document = { openapi: "3.0.3", info: { title: "Request input", version: "1" }, tags: [{ name: "input" }], paths: Object.fromEntries(cases.map(({ id, parameters, requestBody }) => [`/${id}${parameters?.some((p) => p.in === "path") ? "/{id}" : ""}`, { post: { operationId: id, tags: ["input"], parameters, requestBody, responses: { "204": { description: "ok" } } } }])), components: { requestBodies: { Required: body(true) } } } as OpenAPIDocument;
		const before = JSON.stringify(document);
		const generate = () => new PluginManager({ root: ".", input: { path: "input.json" }, output: { dir: "test-output/request-input" }, plugins: [definePlugin()] }, structuredClone(document)).execute();
		const first = await generate();
		expect(first.diagnostics).toEqual([]);
		const sources = first.sourceFiles.map((source) => source.getFullText());
		for (const item of cases) expect(sources.join("\n")).toContain(item.expected);
		const empty = sources.find((source) => source.includes("EmptyRequestInput")) ?? "";
		expect(empty).toContain("EmptyHeaderParams");
		expect(empty).toContain("EmptyCookieParams");
		for (const source of sources) {
			const input = source.match(/export type \w+RequestInput = ([\s\S]*?);/)?.[1];
			if (input) expect(input).not.toMatch(/headers|cookies/);
		}
		const second = await generate();
		const manifest = (result: typeof first) => result.sourceFiles.map((source): [string, string] => [source.getFilePath(), source.getFullText()]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
		expect(manifest(second)).toEqual(manifest(first));
		expect(JSON.stringify(document)).toBe(before);
		const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true, exactOptionalPropertyTypes: true, noEmit: true, allowImportingTsExtensions: true } });
		for (const source of first.sourceFiles) project.createSourceFile(source.getFilePath(), source.getFullText());
		const emptySource = first.sourceFiles.find((source) => source.getFullText().includes("EmptyRequestInput"));
		if (!emptySource) throw new Error("Missing empty input artifact");
		project.createSourceFile(path.join(path.dirname(emptySource.getFilePath()), "consumer.ts"), `
import type { EmptyRequestInput } from './empty.types';
import type { OptionalQueryRequestInput } from './optional-query.types';
import type { RequiredQueryRequestInput } from './required-query.types';
import type { OptionalBodyRequestInput } from './optional-body.types';
import type { RequiredBodyRequestInput } from './required-body.types';
const empty: EmptyRequestInput = {};
const optionalQuery: OptionalQueryRequestInput = { query: undefined };
const optionalBody: OptionalBodyRequestInput = { body: undefined };
// @ts-expect-error headers must not enter A1 public input
const headers: EmptyRequestInput = { headers: { 'X-Dummy': 'dummy' } };
// @ts-expect-error cookies must not enter A1 public input
const cookies: EmptyRequestInput = { cookies: { dummy: 'dummy' } };
// @ts-expect-error required query must not be omitted
const missingQuery: RequiredQueryRequestInput = {};
// @ts-expect-error required body must not be omitted
const missingBody: RequiredBodyRequestInput = {};
void [empty, optionalQuery, optionalBody, headers, cookies, missingQuery, missingBody];
`);
		expect(project.getPreEmitDiagnostics().map((diagnostic) => diagnostic.getMessageText())).toEqual([]);
	});
});
