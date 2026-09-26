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
			if (pathname === "/cached-bridge") {
        response.end(JSON.stringify({ Pet: { $ref: `${originA}/cached-root#/components/schemas/Z` } }));
      } else if (pathname === "/multi-middle") {
				response.writeHead(302, { location: "/final" }).end();
			} else if (pathname === "/return.yaml") {
        response.end(`openapi: 3.1.0\ninfo: { title: Return, version: "1" }\npaths: {}\ncomponents:\n  schemas:\n    Pet:\n      $ref: ${originA}/schema-back.yaml#/$defs/Pet\n`);
      } else if (pathname === "/nested.yaml") {
        response.end(`openapi: 3.1.0\ninfo: { title: Nested, version: "1" }\npaths: {}\ncomponents:\n  schemas:\n    Pet:\n      $ref: ./schema.yaml#/$defs/Pet\n`);
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
			if (pathname === "/cached-root") {
        response.end(JSON.stringify({ openapi: "3.1.0", info: { title: "Cached root", version: "1" }, paths: {}, components: { schemas: { A: { $ref: `${originB}/cached-bridge#/Pet` }, Z: { $ref: "./cached-private#/$defs/Pet" } } } }));
      } else if (pathname === "/cached-private") {
        response.end(JSON.stringify({ $defs: { Pet: { type: "string" } } }));
      } else if (pathname === "/same-start") {
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
			} else if (pathname === "/schema-back.yaml") {
        response.end(`$defs:\n  Pet:\n    $ref: ${originA}/schema-end.yaml#/$defs/Pet\n`);
      } else if (pathname === "/schema-end.yaml") {
        response.end('$defs:\n  Pet: { type: object }\n');
      } else if (pathname === "/return-ref.yaml") {
        response.end(`openapi: 3.1.0\ninfo: { title: Return root, version: "1" }\npaths: {}\ncomponents:\n  schemas:\n    Pet:\n      $ref: ${originB}/return.yaml#/components/schemas/Pet\n`);
      } else if (pathname === "/direct-ref.yaml" || pathname === "/self-ref.yaml") {
        response.end(`openapi: 3.1.0\n${pathname === "/self-ref.yaml" ? `$self: ${originB}/self-ref.yaml\n` : ''}info: { title: Direct, version: "1" }\npaths: {}\ncomponents:\n  schemas:\n    Pet:\n      $ref: ${pathname === "/self-ref.yaml" ? './schema.yaml' : `${originB}/nested.yaml`}#/components/schemas/Pet\n`);
      } else if (pathname === "/redirected-root") {
        response.writeHead(302, { location: `${originB}/nested.yaml` }).end();
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

  it('blocks cross-origin redirects by default even when the hostname is unchanged', async () => {
    requests.delete('B/final');
    const result = await loadOpenAPIDocument(`${originA}/cross-start`);
    expect(result.diagnostics[0]?.code).toBe('REMOTE_SOURCE_BLOCKED');
    expect(requests.has('B/final')).toBe(false);
  });

  it('strips credentials from direct cross-origin refs and their nested same-origin refs', async () => {
    const result = await compileOpenAPI(`${originA}/direct-ref.yaml`, { remote });
    expect(result.success).toBe(true);
    expect(requests.get('B/nested.yaml')).toEqual({});
    expect(requests.get('B/schema.yaml')).toEqual({});
  });

  it('does not restore root credentials after a cross-origin root redirect', async () => {
    const result = await compileOpenAPI(`${originA}/redirected-root`, { remote });
    expect(result.success).toBe(true);
    expect(requests.get('B/schema.yaml')).toEqual({});
  });

  it('does not send root credentials on a cross-origin ref back to the root origin', async () => {
    const result = await compileOpenAPI(`${originA}/return-ref.yaml`, { remote });
    expect(result.success).toBe(true);
    expect(requests.get('A/schema-back.yaml')).toEqual({});
    expect(requests.get('A/schema-end.yaml')).toEqual({});
  });

  it('does not restore credentials when a cross-origin ref returns to the cached root', async () => {
    const result = await compileOpenAPI(`${originA}/cached-root`, { remote });
    expect(result.success).toBe(true);
    expect(requests.get('A/cached-root')).toHaveProperty('authorization', 'Bearer redirect-secret');
    expect(requests.get('B/cached-bridge')).toEqual({});
    expect(requests.get('A/cached-private')).toEqual({});
  });

  it('does not let document $self grant cross-origin authority', async () => {
    requests.delete('B/schema.yaml');
    const result = await compileOpenAPI(`${originA}/self-ref.yaml`);
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'REMOTE_SOURCE_BLOCKED' })]));
    expect(requests.has('B/schema.yaml')).toBe(false);
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
