import { once } from "node:events";
import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileOpenAPI } from "./compiler.ts";
import {
	isRemoteRedirectDowngrade,
	isSameRemoteOrigin,
	loadOpenAPIDocument,
} from "./sourceLoader.ts";

const configuredHeaders = {
	Authorization: "Bearer redirect-secret",
	"Proxy-Authorization": "Basic proxy-secret",
	Cookie: "session=secret",
	"X-Api-Key": "api-secret",
	"X-Custom": "custom-secret",
	"Set-Cookie": "must-not-be-a-request-header",
};

function receivedConfiguredHeaders(
	headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[] | undefined> {
	const configuredNames = new Set(
		Object.keys(configuredHeaders).map((name) => name.toLowerCase()),
	);
	return Object.fromEntries(
		Object.entries(headers).filter(([name]) =>
			configuredNames.has(name.toLowerCase()),
		),
	);
}

describe("remote redirect origin security", { concurrent: false }, () => {
	let serverA: Server;
	let serverB: Server;
	let originA: string;
	let originB: string;
	let previousNoProxy: string | undefined;
	const requests = new Map<
		string,
		Record<string, string | string[] | undefined>
	>();

	beforeAll(async () => {
		previousNoProxy = process.env.NO_PROXY;
		process.env.NO_PROXY = "127.0.0.1,localhost";
		serverB = createServer((request, response) => {
			const pathname = new URL(request.url ?? "/", originB).pathname;
			requests.set(`B${pathname}`, receivedConfiguredHeaders(request.headers));
			if (pathname === "/multi-middle") {
				response.writeHead(302, { location: "/final" }).end();
			} else if (pathname === "/schema.yaml") {
				response.end("$defs:\n  Pet:\n    type: object\n");
			} else {
				response.end(
					'{"openapi":"3.1.0","info":{"title":"Cross origin","version":"1"},"paths":{}}',
				);
			}
		});
		serverB.listen(0, "127.0.0.1");
		await once(serverB, "listening");
		originB = `http://127.0.0.1:${(serverB.address() as { port: number }).port}`;

		serverA = createServer((request, response) => {
			const pathname = new URL(request.url ?? "/", originA).pathname;
			requests.set(`A${pathname}`, receivedConfiguredHeaders(request.headers));
			if (pathname === "/same-start") {
				response.writeHead(302, { location: "/same-final" }).end();
			} else if (pathname === "/cross-start") {
				response.writeHead(302, { location: `${originB}/final` }).end();
			} else if (pathname === "/multi-start") {
				response.writeHead(302, { location: "/multi-middle" }).end();
			} else if (pathname === "/multi-middle") {
				response.writeHead(302, { location: `${originB}/multi-middle` }).end();
			} else if (pathname === "/root-ref.yaml") {
				response.end(
					`openapi: 3.1.0\ninfo: { title: Ref, version: "1" }\npaths: {}\ncomponents:\n  schemas:\n    Pet:\n      $ref: ${originA}/schema-start#/$defs/Pet\n`,
				);
			} else if (pathname === "/schema-start") {
				response.writeHead(302, { location: `${originB}/schema.yaml` }).end();
			} else {
				response.end(
					'{"openapi":"3.1.0","info":{"title":"Same origin","version":"1"},"paths":{}}',
				);
			}
		});
		serverA.listen(0, "127.0.0.1");
		await once(serverA, "listening");
		originA = `http://127.0.0.1:${(serverA.address() as { port: number }).port}`;
	});

	afterAll(async () => {
		if (!serverA || !serverB) return;
		const closedA = once(serverA, "close");
		const closedB = once(serverB, "close");
		serverA.close();
		serverB.close();
		serverA.closeAllConnections();
		serverB.closeAllConnections();
		await Promise.all([closedA, closedB]);
		if (previousNoProxy === undefined) delete process.env.NO_PROXY;
		else process.env.NO_PROXY = previousNoProxy;
	});

	const remote = {
		allowPrivateNetwork: true,
		allowedHosts: ["127.0.0.1"],
		headers: configuredHeaders,
	};

	it("retains configured request headers only for same-origin redirects", async () => {
		const result = await loadOpenAPIDocument(`${originA}/same-start`, {
			remote,
		});
		expect(result.document?.info.title).toBe("Same origin");
		expect(requests.get("A/same-final")).toMatchObject({
			authorization: "Bearer redirect-secret",
			"proxy-authorization": "Basic proxy-secret",
			cookie: "session=secret",
			"x-api-key": "api-secret",
			"x-custom": "custom-secret",
		});
		expect(requests.get("A/same-final")).not.toHaveProperty("set-cookie");
	});

	it("removes every configured header on a cross-origin redirect", async () => {
		const result = await loadOpenAPIDocument(`${originA}/cross-start`, {
			remote,
		});
		expect(result.document?.info.title).toBe("Cross origin");
		expect(requests.get("B/final")).toEqual({});
	});

	it("does not restore headers after a same-origin then cross-origin multi-hop", async () => {
		const result = await loadOpenAPIDocument(`${originA}/multi-start`, {
			remote,
		});
		expect(result.document?.info.title).toBe("Cross origin");
		expect(requests.get("A/multi-middle")).toHaveProperty(
			"authorization",
			"Bearer redirect-secret",
		);
		expect(requests.get("B/multi-middle")).toEqual({});
		expect(requests.get("B/final")).toEqual({});
	});

	it("uses the same cross-origin header rule for a redirected root and external ref", async () => {
		const root = await loadOpenAPIDocument(`${originA}/cross-start`, {
			remote,
		});
		const referenced = await compileOpenAPI(`${originA}/root-ref.yaml`, {
			remote,
		});
		expect(root.document).toBeDefined();
		expect(referenced.success).toBe(true);
		expect(requests.get("B/final")).toEqual({});
		expect(requests.get("B/schema.yaml")).toEqual({});
	});

	it("compares scheme, hostname, and effective port and blocks HTTPS downgrades", () => {
		expect(
			isSameRemoteOrigin(
				new URL("https://api.example.com/a"),
				new URL("https://api.example.com:443/b"),
			),
		).toBe(true);
		expect(
			isSameRemoteOrigin(
				new URL("https://api.example.com/a"),
				new URL("https://api.example.com:8443/b"),
			),
		).toBe(false);
		expect(
			isSameRemoteOrigin(
				new URL("http://api.example.com/a"),
				new URL("https://api.example.com/b"),
			),
		).toBe(false);
		expect(
			isRemoteRedirectDowngrade(
				new URL("https://api.example.com/a"),
				new URL("http://api.example.com/b"),
			),
		).toBe(true);
		expect(
			isRemoteRedirectDowngrade(
				new URL("http://api.example.com/a"),
				new URL("https://api.example.com/b"),
			),
		).toBe(false);
	});
});
