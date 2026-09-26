import { access, mkdtemp, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { OpenapiToConfig } from "../types";
import { preflightConfiguredTargets } from "./preflight.ts";

describe("preflightConfiguredTargets", () => {
	it("compiles every selected JSON/YAML/YML input before creating output", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "configured-preflight-"));
		await writeFile(
			path.join(root, "user.json"),
			JSON.stringify({
				openapi: "3.1.0",
				info: { title: "User", version: "1" },
				paths: {},
			}),
		);
		await writeFile(
			path.join(root, "order.yaml"),
			'openapi: 3.1.0\ninfo: { title: Order, version: "1" }\npaths: {}\n',
		);
		await writeFile(
			path.join(root, "payment.yml"),
			'openapi: 3.1.0\ninfo: { title: Payment, version: "1" }\npaths: {}\n',
		);
		const config: OpenapiToConfig = {
			servers: [
				{
					name: "user",
					input: { path: "./user.json" },
					output: { base: "workspace", dir: "src/generated/user" },
				},
				{
					name: "order",
					input: { path: "./order.yaml" },
					output: { base: "workspace", dir: "src/generated/order" },
				},
				{
					name: "payment",
					input: { path: "./payment.yml" },
					output: { dir: "payment" },
				},
			],
			plugins: [],
		};
		const prepared = await preflightConfiguredTargets(config, {
			workspaceRoot: root,
			localFileRoot: root,
		});
		expect(
			prepared.map(({ name, compilation }) => [
				name,
				compilation?.document?.info.title,
			]),
		).toEqual([
			["user", "User"],
			["order", "Order"],
			["payment", "Payment"],
		]);
		await expect(access(path.join(root, "src/generated"))).rejects.toThrow();
		await expect(access(path.join(root, ".openapi-to"))).rejects.toThrow();
	});

	it("loads all selected inputs before a caller can write any target", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "configured-preflight-"));
		await writeFile(
			path.join(root, "valid.yaml"),
			'openapi: 3.1.0\ninfo: { title: Valid, version: "1" }\npaths: {}\n',
		);
		const prepared = await preflightConfiguredTargets(
			{
				servers: [
					{
						name: "valid",
						input: { path: "./valid.yaml" },
						output: { dir: "valid" },
					},
					{
						name: "invalid",
						input: { path: "./missing.yaml" },
						output: { dir: "invalid" },
					},
				],
				plugins: [],
			},
			{ workspaceRoot: root, localFileRoot: root },
		);
		expect(prepared[0]?.compilation?.success).toBe(true);
		expect(prepared[1]?.compilation?.diagnostics[0]?.code).toBe(
			"INPUT_READ_FAILED",
		);
		await expect(access(path.join(root, ".openapi-to"))).rejects.toThrow();
	});

	it("reuses one remote response across selected targets in one preflight", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "configured-preflight-"));
		let requests = 0;
		const server = createServer((_request, response) => {
			requests += 1;
			response.end(
				'{"openapi":"3.1.0","info":{"title":"Shared","version":"1"},"paths":{}}',
			);
		});
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		try {
			const port = (server.address() as { port: number }).port;
			const input = `http://127.0.0.1:${port}/openapi?service=shared`;
			const prepared = await preflightConfiguredTargets(
				{
					servers: [
						{
							name: "first",
							input: {
								path: input,
							},
							output: { dir: "first" },
						},
						{
							name: "second",
							input: {
								path: input,
							},
							output: { dir: "second" },
						},
					],
					plugins: [],
				},
				{ workspaceRoot: root, localFileRoot: root },
			);
			expect(prepared.every(({ compilation }) => compilation?.success)).toBe(
				true,
			);
			expect(requests).toBe(1);
		} finally {
			const closed = once(server, "close");
			server.close();
			server.closeAllConnections();
			await closed;
		}
	});
});
