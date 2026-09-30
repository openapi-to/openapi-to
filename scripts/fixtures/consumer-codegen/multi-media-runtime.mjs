import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PluginManager, pluginZod } from "openapi-to";
import { z } from "zod";

const documentPath = process.argv[2];
assert.ok(documentPath, "Expected a path to the multi-media OpenAPI fixture.");
const document = JSON.parse(await readFile(documentPath, "utf8"));

function reverseKeys(value) {
	const entries = Object.entries(value).reverse();
	for (const key of Object.keys(value)) delete value[key];
	Object.assign(value, Object.fromEntries(entries));
}

function makeManager(openAPIDocument) {
	return new PluginManager(
		{
			root: process.cwd(),
			plugins: [pluginZod({ importWithExtension: false })],
			input: { path: documentPath },
			output: { dir: path.join(process.cwd(), "generated-multi-media") },
		},
		openAPIDocument,
	);
}

function sourceEnding(result, suffix) {
	const sourceFile = result.sourceFiles.find((candidate) =>
		candidate.getFilePath().replaceAll("\\", "/").endsWith(suffix),
	);
	assert.ok(sourceFile, `Missing generated source ending in ${suffix}.`);
	return sourceFile.getFullText();
}

function initializer(source, name) {
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const found = new RegExp(
		`^export const ${escaped} = ([\\s\\S]*?);$`,
		"m",
	).exec(source);
	assert.ok(found, `Missing generated schema ${name}.`);
	return found[1];
}

function evaluate(source, name, dependencies = {}) {
	const dependencyNames = Object.keys(dependencies);
	return new Function(
		"z",
		...dependencyNames,
		`return (${initializer(source, name)});`,
	)(
		z,
		...dependencyNames.map((dependencyName) => dependencies[dependencyName]),
	);
}

const first = await makeManager(document).execute();
const reorderedDocument = structuredClone(document);
reverseKeys(reorderedDocument.paths["/inline"].post.requestBody.content);
reverseKeys(reorderedDocument.paths["/inline"].post.responses["200"].content);
reverseKeys(reorderedDocument.components.requestBodies.MultiBody.content);
reverseKeys(reorderedDocument.components.responses.MultiResponse.content);
const second = await makeManager(reorderedDocument).execute();

const multiDiagnostics = first.diagnostics.filter(
	({ code }) => code === "ZOD_MULTIPLE_MEDIA_TYPES_UNSUPPORTED",
);
assert.equal(multiDiagnostics.length, 7);
assert.ok(multiDiagnostics.every(({ severity }) => severity === "error"));
assert.ok(
	multiDiagnostics.every(({ message }) => message.includes("z.never()")),
	"Each multi-media diagnostic must describe the fail-closed generated body.",
);
assert.deepEqual(second.diagnostics, first.diagnostics);

const inline = sourceEnding(first, "/media/inline-media.schema.ts");
const componentOperation = sourceEnding(
	first,
	"/media/component-media.schema.ts",
);
const componentBodyFile = sourceEnding(
	first,
	"/zod/requestBodies/multi-body.schema.ts",
);
const componentResponseFile = sourceEnding(
	first,
	"/zod/responses/multi-response.schema.ts",
);
assert.equal(inline, sourceEnding(second, "/media/inline-media.schema.ts"));
assert.equal(
	componentOperation,
	sourceEnding(second, "/media/component-media.schema.ts"),
);
assert.equal(
	componentBodyFile,
	sourceEnding(second, "/zod/requestBodies/multi-body.schema.ts"),
);
assert.equal(
	componentResponseFile,
	sourceEnding(second, "/zod/responses/multi-response.schema.ts"),
);

const body = evaluate(inline, "inlineMediaMutationRequestSchema");
const response200 = evaluate(
	inline,
	"inlineMediaMutationSchemaResponseSchema200",
);
const response201 = evaluate(
	inline,
	"inlineMediaMutationSchemaResponseSchema201",
);
const successAggregate = evaluate(
	inline,
	"inlineMediaMutationSchemaResponseSchema",
);
const errorAggregate = evaluate(inline, "inlineMediaResponseErrorSchema");
const multiBody = evaluate(componentBodyFile, "multiBodySchema");
const multiResponse = evaluate(componentResponseFile, "ResponseMultiResponse");
const componentBodyAlias = evaluate(
	componentOperation,
	"componentMediaMutationRequestSchema",
	{
		multiBodySchema: multiBody,
	},
);

for (const schema of [
	body,
	response200,
	successAggregate,
	errorAggregate,
	multiBody,
	multiResponse,
	componentBodyAlias,
]) {
	assert.equal(schema.safeParse({ id: 1 }).success, false);
	assert.equal(schema.safeParse("hello").success, false);
}
assert.equal(response201.safeParse("hello").success, true);
assert.ok(
	!inline.includes("JsonBodySchema") && !inline.includes("TextBodySchema"),
);
assert.ok(
	!componentBodyFile.includes("jsonBodySchema") &&
		!componentBodyFile.includes("textBodySchema"),
);
assert.ok(
	!componentResponseFile.includes("jsonBodySchema") &&
		!componentResponseFile.includes("textBodySchema"),
);

console.log("packed multi-media Zod consumer: PASS");
