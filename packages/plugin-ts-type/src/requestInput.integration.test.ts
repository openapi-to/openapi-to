import path from "node:path";
import { type OpenAPIDocument, PluginManager } from "@openapi-to/core";
import { Project } from "ts-morph";
import { describe, expect, it } from "vitest";
import { definePlugin } from "./plugin.ts";

describe("grouped RequestInput", () => {
	it("emits effective request-group requiredness, reuses HeaderParams and CookieParams, and is deterministic", async () => {
		const parameter = (name: string, location: string, required = false) => ({
			name,
			in: location,
			required,
			schema: { type: "string" },
		});
		const body = (required: boolean) => ({
			required,
			content: { "application/json": { schema: { type: "string" } } },
		});
		const cases = [
			{
				id: "pathOnly",
				parameters: [parameter("id", "path", true)],
				expected: "path: PathOnlyPathParams",
			},
			{
				id: "optionalQuery",
				parameters: [parameter("q", "query")],
				expected: "query?: OptionalQueryQueryParams",
			},
			{
				id: "requiredQuery",
				parameters: [parameter("q", "query", true)],
				expected: "query: RequiredQueryQueryParams",
			},
			{
				id: "optionalBody",
				requestBody: body(false),
				expected: "body?: OptionalBodyMutationRequest",
			},
			{
				id: "requiredBody",
				requestBody: { $ref: "#/components/requestBodies/Required" },
				expected: "body: RequiredBodyMutationRequest",
			},
			{
				id: "allGroups",
				parameters: [
					parameter("id", "path", true),
					parameter("q", "query", true),
				],
				requestBody: body(true),
				expected: "body: AllGroupsMutationRequest",
			},
			{
				id: "requiredHeader",
				parameters: [parameter("X-Trace", "header", true)],
				expected: "headers: RequiredHeaderHeaderParams",
			},
			{
				id: "optionalHeader",
				parameters: [parameter("X-Trace", "header")],
				expected: "headers?: OptionalHeaderHeaderParams | undefined",
			},
			{
				id: "ignoredHeaders",
				parameters: [
					parameter("Accept", "header", true),
					parameter("content-type", "header", true),
					parameter("AUTHORIZATION", "header", true),
				],
				expected: "IgnoredHeadersRequestInput = Record<string, never>",
			},
			{
				id: "empty",
				parameters: [],
				expected: "EmptyRequestInput = Record<string, never>",
			},
			{
				id: "requiredCookie",
				parameters: [parameter("session", "cookie", true)],
				expected: "cookies: RequiredCookieCookieParams",
			},
			{
				id: "optionalCookie",
				parameters: [parameter("tenant", "cookie")],
				expected: "cookies?: OptionalCookieCookieParams | undefined",
			},
			{
				id: "contentQuery",
				parameters: [
					{
						name: "filter",
						in: "query",
						content: { "application/json": { schema: { type: "string" } } },
					},
				],
				expected: "query?: ContentQueryQueryParams",
			},
		];
		const document = {
			openapi: "3.0.3",
			info: { title: "Request input", version: "1" },
			tags: [{ name: "input" }],
			paths: Object.fromEntries(
				cases.map(({ id, parameters, requestBody }) => [
					`/${id}${parameters?.some((p) => p.in === "path") ? "/{id}" : ""}`,
					{
						post: {
							operationId: id,
							tags: ["input"],
							parameters,
							requestBody,
							responses: { "204": { description: "ok" } },
						},
					},
				]),
			),
			components: { requestBodies: { Required: body(true) } },
		} as OpenAPIDocument;
		const before = JSON.stringify(document);
		const generate = () =>
			new PluginManager(
				{
					root: ".",
					input: { path: "input.json" },
					output: { dir: "test-output/request-input" },
					plugins: [definePlugin()],
				},
				structuredClone(document),
			).execute();
		const first = await generate();
		expect(first.diagnostics).toEqual([]);
		const sources = first.sourceFiles.map((source) => source.getFullText());
		for (const item of cases)
			expect(sources.join("\n")).toContain(item.expected);
		const empty =
			sources.find((source) => source.includes("EmptyRequestInput")) ?? "";
		expect(empty).not.toContain("EmptyCookieParams");
		expect(empty).not.toMatch(/headers|cookies/);
		const requiredHeader =
			sources.find((source) => source.includes("RequiredHeaderRequestInput")) ??
			"";
		expect(requiredHeader).toContain("RequiredHeaderHeaderParams");
		const ignored =
			sources.find((source) => source.includes("IgnoredHeadersRequestInput")) ??
			"";
		expect(ignored).toContain(
			"IgnoredHeadersRequestInput = Record<string, never>",
		);
		const second = await generate();
		const manifest = (result: typeof first) =>
			result.sourceFiles
				.map((source): [string, string] => [
					source.getFilePath(),
					source.getFullText(),
				])
				.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		expect(manifest(second)).toEqual(manifest(first));
		expect(JSON.stringify(document)).toBe(before);
		const project = new Project({
			useInMemoryFileSystem: true,
			compilerOptions: {
				strict: true,
				exactOptionalPropertyTypes: true,
				noEmit: true,
				allowImportingTsExtensions: true,
			},
		});
		for (const source of first.sourceFiles)
			project.createSourceFile(source.getFilePath(), source.getFullText());
		const emptySource = first.sourceFiles.find((source) =>
			source.getFullText().includes("EmptyRequestInput"),
		);
		if (!emptySource) throw new Error("Missing empty input artifact");
		project.createSourceFile(
			path.join(path.dirname(emptySource.getFilePath()), "consumer.ts"),
			`
import type { EmptyRequestInput } from './empty.types';
import type { OptionalQueryRequestInput } from './optional-query.types';
import type { RequiredQueryRequestInput } from './required-query.types';
import type { OptionalBodyRequestInput } from './optional-body.types';
import type { RequiredBodyRequestInput } from './required-body.types';
import type { RequiredHeaderRequestInput } from './required-header.types';
import type { OptionalHeaderRequestInput } from './optional-header.types';
import type { IgnoredHeadersRequestInput } from './ignored-headers.types';
import type { RequiredCookieRequestInput } from './required-cookie.types';
import type { OptionalCookieRequestInput } from './optional-cookie.types';
const empty: EmptyRequestInput = {};
const optionalQuery: OptionalQueryRequestInput = { query: undefined };
const optionalBody: OptionalBodyRequestInput = { body: undefined };
const requiredHeader: RequiredHeaderRequestInput = { headers: { 'X-Trace': 'request-123' } };
const optionalHeader: OptionalHeaderRequestInput = { headers: undefined };
const ignoredHeaders: IgnoredHeadersRequestInput = {};
// @ts-expect-error headers must not enter A1 public input
const headers: EmptyRequestInput = { headers: { 'X-Dummy': 'dummy' } };
const optionalCookies: OptionalCookieRequestInput = {};
const requiredCookies: RequiredCookieRequestInput = { cookies: { session: 'synthetic-session' } };
// @ts-expect-error required query must not be omitted
const missingQuery: RequiredQueryRequestInput = {};
// @ts-expect-error required body must not be omitted
const missingBody: RequiredBodyRequestInput = {};
// @ts-expect-error required OpenAPI Header group must not be omitted
const missingHeader: RequiredHeaderRequestInput = {};
// @ts-expect-error required Cookie group must not be omitted
const missingCookies: RequiredCookieRequestInput = {};
void [empty, optionalQuery, optionalBody, requiredHeader, optionalHeader, ignoredHeaders, headers, optionalCookies, requiredCookies, missingQuery, missingBody, missingHeader, missingCookies];
`,
		);
		expect(
			project
				.getPreEmitDiagnostics()
				.map((diagnostic) => diagnostic.getMessageText()),
		).toEqual([]);
	});
});
