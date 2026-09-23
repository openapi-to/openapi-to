import { mkdir, mkdtemp, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { OpenapiToConfigServer } from "../types";
import { selectConfiguredTargets } from "./configuredTargets.ts";
import {
	resolveConfiguredOutputRoot,
	resolveConfiguredTargetOutputs,
	resolveEffectiveTargetOutputs,
} from "./outputRoot.ts";

function target(
	name: string,
	output: OpenapiToConfigServer["output"],
): OpenapiToConfigServer {
	return { name, input: { path: "./openapi.yaml" }, output };
}

describe("configured output roots", () => {
	it("preserves managed defaults and supports explicit Workspace output", () => {
		const root = path.resolve("/workspace");
		expect(
			resolveConfiguredOutputRoot({
				workspaceRoot: root,
				output: { dir: "generated" },
			}),
		).toEqual({
			absolutePath: path.join(root, ".openapi-to", "generated"),
			workspaceRelativePath: ".openapi-to/generated",
			base: "managed",
		});
		expect(
			resolveConfiguredOutputRoot({
				workspaceRoot: root,
				output: { base: "workspace", dir: "src/api/generated" },
			}),
		).toEqual({
			absolutePath: path.join(root, "src", "api", "generated"),
			workspaceRelativePath: "src/api/generated",
			base: "workspace",
		});
	});

	it.each([
		[{ base: "workspace", dir: "." }, "CONFIG_OUTPUT_WORKSPACE_ROOT"],
		[{ base: "workspace", dir: "" }, "CONFIG_OUTPUT_PATH_INVALID"],
		[
			{ base: "workspace", dir: "../outside" },
			"CONFIG_OUTPUT_PATH_OUTSIDE_WORKSPACE",
		],
		[
			{ base: "workspace", dir: "/absolute" },
			"CONFIG_OUTPUT_PATH_OUTSIDE_WORKSPACE",
		],
		[
			{ base: "workspace", dir: "C:\\outside" },
			"CONFIG_OUTPUT_PATH_OUTSIDE_WORKSPACE",
		],
		[
			{ base: "workspace", dir: "C:outside" },
			"CONFIG_OUTPUT_PATH_OUTSIDE_WORKSPACE",
		],
		[
			{ base: "workspace", dir: "\\\\server\\share" },
			"CONFIG_OUTPUT_PATH_OUTSIDE_WORKSPACE",
		],
		[
			{ base: "workspace", dir: ".git/generated" },
			"CONFIG_OUTPUT_PROTECTED_PATH",
		],
		[
			{ base: "workspace", dir: "node_modules/generated" },
			"CONFIG_OUTPUT_PROTECTED_PATH",
		],
		[
			{ base: "workspace", dir: ".openapi-to/selections" },
			"CONFIG_OUTPUT_PROTECTED_PATH",
		],
		[
			{ base: "workspace", dir: ".openapi-to/transactions" },
			"CONFIG_OUTPUT_PROTECTED_PATH",
		],
		[
			{ base: "workspace", dir: ".openapi-to/locks" },
			"CONFIG_OUTPUT_PROTECTED_PATH",
		],
		[
			{ base: "workspace", dir: ".openapi-to/cache" },
			"CONFIG_OUTPUT_PROTECTED_PATH",
		],
		[
			{ base: "workspace", dir: ".openapi-to/previews" },
			"CONFIG_OUTPUT_PROTECTED_PATH",
		],
		[
			{ base: "workspace", dir: ".openapi-to/generated" },
			"CONFIG_OUTPUT_PROTECTED_PATH",
		],
	])("rejects unsafe output %#", (output, code) => {
		expect(() =>
			resolveConfiguredOutputRoot({
				workspaceRoot: "/workspace",
				output: output as OpenapiToConfigServer["output"],
			}),
		).toThrowError(
			expect.objectContaining({
				diagnostics: [expect.objectContaining({ code })],
			}),
		);
	});

	it("rejects equal, parent/child, and mixed-base overlaps", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "output-overlap-"));
		for (const servers of [
			[
				target("a", { base: "workspace", dir: "src/api" }),
				target("b", { base: "workspace", dir: "src/api" }),
			],
			[
				target("a", { base: "workspace", dir: "src/api" }),
				target("b", { base: "workspace", dir: "src/api/order" }),
			],
		]) {
			await expect(
				resolveConfiguredTargetOutputs(
					root,
					selectConfiguredTargets({ servers }),
				),
			).rejects.toMatchObject({
				diagnostics: [
					expect.objectContaining({ code: "CONFIG_OUTPUT_OVERLAP" }),
				],
			});
		}
	});

	it("validates caller-selected roots against protected paths and every trusted target", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "output-dynamic-"));
		const targets = selectConfiguredTargets({
			servers: [
				target("selected", { base: "workspace", dir: "generated/default" }),
				target("other", { base: "workspace", dir: "src/other/generated" }),
			],
		});
		const resolved = await resolveEffectiveTargetOutputs(
			root,
			targets,
			new Map([["selected", "src/selected/generated"]]),
		);
		expect(resolved.get("selected")?.workspaceRelativePath).toBe(
			"src/selected/generated",
		);
		await expect(
			resolveEffectiveTargetOutputs(
				root,
				targets,
				new Map([["selected", "src/other"]]),
			),
		).rejects.toMatchObject({
			diagnostics: [expect.objectContaining({ code: "CONFIG_OUTPUT_OVERLAP" })],
		});
		await expect(
			resolveEffectiveTargetOutputs(
				root,
				targets,
				new Map([["selected", ".openapi-to/generation-intents"]]),
			),
		).rejects.toMatchObject({
			diagnostics: [
				expect.objectContaining({ code: "CONFIG_OUTPUT_PROTECTED_PATH" }),
			],
		});
		for (const outputRoot of [".git/config", "node_modules/pkg", ".openapi-to/generated"]) {
			await expect(
				resolveEffectiveTargetOutputs(
					root,
					targets,
					new Map([["selected", outputRoot]]),
				),
			).rejects.toMatchObject({
				diagnostics: [expect.objectContaining({ code: "CONFIG_OUTPUT_PROTECTED_PATH" })],
			});
		}
	});

	it("preserves persisted managed identities and safely resolves dynamic Workspace identities", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "output-persisted-"));
		const targets = selectConfiguredTargets({
			servers: [target("selected", { dir: "generated" })],
		});

		const managed = await resolveEffectiveTargetOutputs(
			root,
			targets,
			new Map(),
			new Map([["selected", ".openapi-to/generated"]]),
		);
		expect(managed.get("selected")).toMatchObject({
			workspaceRelativePath: ".openapi-to/generated",
			base: "managed",
		});

		const dynamic = await resolveEffectiveTargetOutputs(
			root,
			targets,
			new Map(),
			new Map([["selected", "custom-output"]]),
		);
		expect(dynamic.get("selected")).toMatchObject({
			workspaceRelativePath: "custom-output",
			base: "workspace",
		});
	});

	it("reports relocation for a persisted managed identity that differs from current config", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "output-relocation-"));
		const targets = selectConfiguredTargets({
			servers: [target("selected", { dir: "current" })],
		});
		await expect(
			resolveEffectiveTargetOutputs(
				root,
				targets,
				new Map(),
				new Map([["selected", ".openapi-to/previous"]]),
			),
		).rejects.toMatchObject({
			diagnostics: [
				expect.objectContaining({ code: "GENERATION_OUTPUT_RELOCATION_REQUIRED" }),
			],
		});
	});

	it.each([
		"CON",
		"con",
		"CON.txt",
		"NUL",
		"CLOCK$",
		"COM1",
		"COM9",
		"LPT1",
		"LPT9",
		"generated.",
		"generated ",
		"api. ",
		"api:client",
		"api?client",
		"api<client",
		'api"client',
		"api|client",
		"api*client",
		"api\u0001client",
	])("rejects non-portable output segment %s", (dir) => {
		expect(() =>
			resolveConfiguredOutputRoot({
				workspaceRoot: "/workspace",
				output: { base: "workspace", dir },
				targetName: "portable",
			}),
		).toThrowError(
			expect.objectContaining({
				diagnostics: [
					expect.objectContaining({
						code: "CONFIG_OUTPUT_PATH_NOT_PORTABLE",
						message: expect.stringContaining(JSON.stringify(dir)),
					}),
				],
			}),
		);
	});

	it.each([
		"COM10",
		"LPT10",
		"connection",
		"console",
		"src/api/generated",
		"packages/api-user/src/generated",
		"user-service",
		"api.v1",
		"_openapi",
		"generated-client",
		"普通/生成目录",
	])("accepts portable output %s", (dir) => {
		expect(
			resolveConfiguredOutputRoot({
				workspaceRoot: "/workspace",
				output: { base: "workspace", dir },
			}).workspaceRelativePath,
		).toBe(dir);
	});

	it("normalizes Unicode deterministically and rejects normalized output collisions", async () => {
		expect(
			resolveConfiguredOutputRoot({
				workspaceRoot: "/workspace",
				output: { base: "workspace", dir: "cafe\u0301/client" },
			}).workspaceRelativePath,
		).toBe("café/client");
		const root = await mkdtemp(path.join(os.tmpdir(), "output-unicode-"));
		await expect(
			resolveConfiguredTargetOutputs(
				root,
				selectConfiguredTargets({
					servers: [
						target("first", { base: "workspace", dir: "café/client" }),
						target("second", {
							base: "workspace",
							dir: "cafe\u0301/client",
						}),
					],
				}),
			),
		).rejects.toMatchObject({
			diagnostics: [expect.objectContaining({ code: "CONFIG_OUTPUT_OVERLAP" })],
		});
	});

	it("rejects an existing output parent symlink", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "output-symlink-"));
		const outside = await mkdtemp(path.join(os.tmpdir(), "output-outside-"));
		await mkdir(path.join(root, "src"));
		await symlink(outside, path.join(root, "src", "linked"), "dir");
		await expect(
			resolveConfiguredTargetOutputs(
				root,
				selectConfiguredTargets({
					servers: [
						target("target", {
							base: "workspace",
							dir: "src/linked/generated",
						}),
					],
				}),
			),
		).rejects.toMatchObject({
			diagnostics: [expect.objectContaining({ code: "CONFIG_OUTPUT_SYMLINK" })],
		});
	});
});
