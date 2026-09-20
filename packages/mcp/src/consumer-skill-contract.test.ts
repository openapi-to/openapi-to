import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

	import {
	applyGenerationInputSchema,
	prepareGenerationInputSchema,
} from "./tools/index.ts";

const repositoryRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../..",
);
const skillFiles = [
	".agents/skills/openapi-to-generate/SKILL.md",
	".agents/skills/openapi-to-generate/references/mcp-workflow.md",
	".agents/skills/openapi-to-generate/references/controlled-write.md",
] as const;
const inputSchemas = {
	openapi_prepare_generation: prepareGenerationInputSchema,
	openapi_apply_generation: applyGenerationInputSchema,
} as const;
type ToolName = keyof typeof inputSchemas;
type ToolInputExample = {
	file: string;
	name: string;
	tool: ToolName;
	input: Record<string, unknown>;
};

function exampleLocation(
	example: Pick<ToolInputExample, "file" | "name" | "tool">,
): string {
	return `${example.file}: Tool input ${example.tool} — ${example.name}`;
}

async function readToolInputExamples(): Promise<ToolInputExample[]> {
	const examples: ToolInputExample[] = [];
	const pattern =
		/Tool input: `(openapi_[a-z_]+)` — ([^\n]+)\n\n```json\n([\s\S]*?)\n```/g;

	for (const file of skillFiles) {
		const contents = await readFile(join(repositoryRoot, file), "utf8");
		const markerCount = [...contents.matchAll(pattern)].filter((match) => match[1] !== "openapi_generate_dry_run").length;
		let parsedCount = 0;
		for (const match of contents.matchAll(pattern)) {
			if (match[1] === "openapi_generate_dry_run") continue;
			parsedCount += 1;
			const [, tool, name, json] = match;
			if (!tool || !name || json === undefined) {
				throw new Error(
					`${file}: marked MCP Tool input is missing its Tool name, example name, or JSON body`,
				);
			}
			if (!(tool in inputSchemas))
				throw new Error(`${file}: unsupported marked MCP Tool ${tool}`);
			let input: unknown;
			try {
				input = JSON.parse(json);
			} catch (error) {
				throw new Error(
					`${file}: Tool input ${tool} — ${name} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
			if (input === null || typeof input !== "object" || Array.isArray(input)) {
				throw new Error(
					`${file}: Tool input ${tool} — ${name} must be one JSON object`,
				);
			}
			examples.push({
				file,
				name,
				tool: tool as ToolName,
				input: input as Record<string, unknown>,
			});
		}
		if (parsedCount !== markerCount) {
			throw new Error(
				`${file}: found ${markerCount} Tool input marker(s), but only ${parsedCount} matched the documented marker and JSON block format`,
			);
		}
	}

	return examples;
}

function validateToolInputExample(example: ToolInputExample): void {
	const location = exampleLocation(example);
	const parsed = inputSchemas[example.tool].safeParse(example.input);
	if (!parsed.success) {
		const issues = parsed.error.issues
			.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
			.join("; ");
		throw new Error(
			`${location} does not match the current MCP inputSchema: ${issues}`,
		);
	}
	if (!isDeepStrictEqual(parsed.data, example.input)) {
		throw new Error(
			`${location} contains unknown fields that the current MCP inputSchema would discard`,
		);
	}

	if (example.tool === "openapi_prepare_generation") {
		const { targets, selection } = example.input;
		if (!Array.isArray(targets) || targets.length !== 1) {
			throw new Error(`${location} must pass exactly one Target`);
		}
		if (
			selection === null ||
			typeof selection !== "object" ||
			Array.isArray(selection) ||
			!["add", "replace"].includes(
				String((selection as Record<string, unknown>).type),
			) ||
			!Array.isArray((selection as Record<string, unknown>).operationKeys) ||
			((selection as Record<string, unknown>).operationKeys as unknown[])
				.length === 0
		) {
			throw new Error(
				`${location} must use a supported selection with non-empty operationKeys`,
			);
		}
	}

	if (example.tool === "openapi_apply_generation") {
		const fields = Object.keys(example.input).sort();
		if (
			!isDeepStrictEqual(fields, ["approvedPlanHash", "planId", "token"]) ||
			typeof example.input.planId !== "string" ||
			typeof example.input.token !== "string" ||
			typeof example.input.approvedPlanHash !== "string"
		) {
			throw new Error(
				`${location} must pass only the exact planId, token, and approvedPlanHash`,
			);
		}
	}
}

describe("openapi-to-generate Tool input examples", () => {
	let examples: ToolInputExample[];

	beforeAll(async () => {
		examples = await readToolInputExamples();
	});

	it("parses every marked JSON example with the actual exported MCP Zod inputSchema", () => {
		expect(new Set(examples.map(({ tool }) => tool))).toEqual(
			new Set(Object.keys(inputSchemas)),
		);
		for (const example of examples) validateToolInputExample(example);
	});

	it("rejects Apply examples with missing plan binding or extra authority", () => {
		const original = examples.find(
			({ tool }) => tool === "openapi_apply_generation",
		);
		expect(original).toBeDefined();

		const missingHash = structuredClone(original?.input ?? {});
		delete missingHash.approvedPlanHash;
		expect(() =>
			validateToolInputExample({
				...(original as ToolInputExample),
				input: missingHash,
			}),
		).toThrow(/does not match the current MCP inputSchema/);

		const extraAuthority = {
			...structuredClone(original?.input ?? {}),
			force: true,
		};
		expect(() =>
			validateToolInputExample({
				...(original as ToolInputExample),
				input: extraAuthority,
			}),
		).toThrow(/does not match the current MCP inputSchema|unknown fields/);

		for (const field of ["planId", "token"] as const) {
			const wrongType = {
				...structuredClone(original?.input ?? {}),
				[field]: 123,
			};
			expect(() =>
				validateToolInputExample({
					...(original as ToolInputExample),
					input: wrongType,
				}),
			).toThrow(/does not match the current MCP inputSchema/);
		}
	});

	it("rejects Prepare examples without one Target or a supported non-empty selection", () => {
		const original = examples.find(
			({ tool, input }) =>
				tool === "openapi_prepare_generation" &&
				(input.selection as Record<string, unknown> | undefined)?.type ===
					"replace",
		);
		expect(original).toBeDefined();
		const input = structuredClone(original?.input ?? {});
		(input.selection as Record<string, unknown>).operationKeys = [];
		expect(() =>
			validateToolInputExample({ ...(original as ToolInputExample), input }),
		).toThrow(/does not match the current MCP inputSchema/);

		for (const targets of [[], ["first", "second"]]) {
			const wrongTargetCount = {
				...structuredClone(original?.input ?? {}),
				targets,
			};
			expect(() =>
				validateToolInputExample({
					...(original as ToolInputExample),
					input: wrongTargetCount,
				}),
			).toThrow(/must pass exactly one Target|does not match the current MCP inputSchema/);
		}

		const unsupportedSelection = structuredClone(original?.input ?? {});
		(unsupportedSelection.selection as Record<string, unknown>).type = "remove";
		expect(() =>
			validateToolInputExample({
				...(original as ToolInputExample),
				input: unsupportedSelection,
			}),
		).toThrow(/does not match the current MCP inputSchema/);
	});
});
