import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { fetchRuntimeSource } from "./fetchRuntime.ts";

let server: Server | undefined;
let runtimeDirectory: string;
type Runtime = {
	FetchTransportError: new (kind: "configuration" | "network" | "abort" | "decode" | "validation", message: string, cause?: unknown) => Error;
	FetchHttpError: new (response: Response, body: unknown, cause?: unknown) => Error;
	resolveFetchUrl: (value: string, baseURL?: string | URL) => URL;
	mergeFetchHeaders: (...layers: HeadersInit[]) => Headers;
	encodeFetchUrlForm: (value: unknown) => URLSearchParams;
	encodeFetchMultipart: (value: unknown) => FormData;
	serializeFetchQuery: (value: unknown, allowed: string[]) => URLSearchParams;
	decodeFetchResponse: (response: Response, declared: string[]) => Promise<unknown>;
	callFetch: (url: URL, method: string, config: (RequestInit & { baseURL?: string | URL }) | undefined, body: BodyInit | undefined, generatedHeaders: HeadersInit, typedHeaders: HeadersInit, declared: string[], responseMedia: Record<string, string[]>, zodParse?: (value: unknown) => unknown) => Promise<unknown>;
};
let runtime: Runtime;

beforeAll(async () => {
	runtimeDirectory = await mkdtemp(path.join(os.tmpdir(), "openapi-to-fetch-runtime-"));
	const output = ts.transpileModule(fetchRuntimeSource, {
		compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
	}).outputText;
	const runtimePath = path.join(runtimeDirectory, "fetch-runtime.mjs");
	await writeFile(path.join(runtimeDirectory, "fetch-runtime.ts"), fetchRuntimeSource, "utf8");
	await writeFile(runtimePath, output, "utf8");
	const program = ts.createProgram([path.join(runtimeDirectory, "fetch-runtime.ts")], {
		noEmit: true,
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.ESNext,
		lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
		strict: true,
		skipLibCheck: true,
	});
	const diagnostics = ts.getPreEmitDiagnostics(program);
	expect(diagnostics.map(({ messageText }) => ts.flattenDiagnosticMessageText(messageText, "\n"))).toEqual([]);
	runtime = await import(pathToFileURL(runtimePath).href) as Runtime;
});

afterEach(async () => {
	vi.unstubAllGlobals();
	const activeServer = server;
	if (activeServer?.listening) await new Promise<void>((resolve) => activeServer.close(() => resolve()));
	server = undefined;
	if (runtimeDirectory) await rm(runtimeDirectory, { recursive: true, force: true });
});

describe("Fetch runtime helpers", () => {
	it("resolves only HTTP(S) URLs using the explicit baseURL", () => {
		expect(runtime.resolveFetchUrl("/pets", "https://example.test/v1").href).toBe("https://example.test/pets");
		expect(runtime.resolveFetchUrl("https://api.example.test/pets").href).toBe("https://api.example.test/pets");
		expect(() => runtime.resolveFetchUrl("/pets")).toThrowError(runtime.FetchTransportError);
		expect(() => runtime.resolveFetchUrl("file:///etc/passwd")).toThrowError(runtime.FetchTransportError);
		expect(() => runtime.resolveFetchUrl("//collector.example/ingest", "https://api.example.test/v1")).toThrowError(runtime.FetchTransportError);
		expect(() => runtime.resolveFetchUrl("\\\\collector.example\\ingest", "https://api.example.test/v1")).toThrowError(runtime.FetchTransportError);
	});

	it("merges case-insensitively and rejects duplicates within one source", () => {
		const headers = runtime.mergeFetchHeaders({ "Content-Type": "application/json" }, { "content-type": "text/plain" });
		expect(headers.get("CONTENT-TYPE")).toBe("text/plain");
		expect(() => runtime.mergeFetchHeaders([["X-Test", "a"], ["x-test", "b"]])).toThrowError(runtime.FetchTransportError);
		expect(() => runtime.mergeFetchHeaders({ "bad name": "x" })).toThrowError(runtime.FetchTransportError);
	});

	it("serializes only flat primitive form values and repeated multipart fields", () => {
		expect(runtime.encodeFetchUrlForm({ z: ["a", "b"], flag: true, count: 3 }).toString()).toBe("count=3&flag=true&z=a&z=b");
		expect(() => runtime.encodeFetchUrlForm({ nested: { x: 1 } })).toThrowError(runtime.FetchTransportError);
		const accessorArray = Object.defineProperty(["safe"], "0", { get: () => "unsafe", enumerable: true });
		expect(() => runtime.encodeFetchUrlForm({ value: accessorArray })).toThrowError(runtime.FetchTransportError);
		const multipart = runtime.encodeFetchMultipart({ item: ["one", "two"] });
		expect(multipart.getAll("item")).toEqual(["one", "two"]);
		expect(() => runtime.encodeFetchMultipart({ ignored: 42 })).toThrowError(runtime.FetchTransportError);
		expect(() => runtime.encodeFetchMultipart({ file: new Blob([new Uint8Array(8 * 1024 * 1024 + 1)]) })).toThrowError(runtime.FetchTransportError);
	});

	it("serializes exploded OpenAPI query objects as bounded flat query members", () => {
		const query = runtime.serializeFetchQuery({ filter: { status: "active", page: 2, tag: ["a", "b"] } }, ["filter"]);
		expect(query.toString()).toBe("page=2&status=active&tag=a&tag=b");
		expect(() => runtime.serializeFetchQuery({ filter: { nested: { key: "value" } } }, ["filter"]))
			.toThrowError(runtime.FetchTransportError);
		expect(() => runtime.serializeFetchQuery({ filter: { date: new Date() } }, ["filter"]))
			.toThrowError(runtime.FetchTransportError);
		expect(() => runtime.serializeFetchQuery({ other: "value" }, ["filter"]))
			.toThrowError(runtime.FetchTransportError);
	});

	it("dispatches response decoding from declared and actual media types", async () => {
		const json = new Response('{"ok":true}', { headers: { "content-type": "application/json" } });
		expect(await runtime.decodeFetchResponse(json, ["application/json"])).toEqual({ ok: true });
		const text = new Response("hello", { headers: { "content-type": "text/plain; charset=utf-8" } });
		expect(await runtime.decodeFetchResponse(text, ["text/*"])).toBe("hello");
		await expect(runtime.decodeFetchResponse(new Response(null), ["text/plain"])).rejects.toMatchObject({ kind: "decode" });
		await expect(runtime.decodeFetchResponse(new Response("x", { headers: { "content-type": "text/html" } }), ["text/plain"])).rejects.toMatchObject({ kind: "decode" });
		await expect(runtime.decodeFetchResponse(new Response("{" , { headers: { "content-type": "application/json" } }), ["application/json"])).rejects.toMatchObject({ kind: "decode" });
		await expect(runtime.decodeFetchResponse(new Response(new Uint8Array(8 * 1024 * 1024 + 1), { headers: { "content-type": "application/pdf" } }), ["application/pdf"])).rejects.toMatchObject({ kind: "decode" });
	});

	it("uses Node global fetch against a bounded local loopback server", async () => {
		const loopbackServer = createServer((request, response) => {
			if (request.url === "/empty") { response.writeHead(204); response.end(); return; }
			if (request.url === "/error") { response.writeHead(400, { "content-type": "application/json" }); response.end('{"message":"bad"}'); return; }
			if (request.url === "/text") { response.writeHead(200, { "content-type": "text/plain" }); response.end("loopback"); return; }
			if (request.url === "/blob") { response.writeHead(200, { "content-type": "application/pdf" }); response.end(Buffer.from([0x25, 0x50, 0x44, 0x46])); return; }
			if (request.url === "/malformed") { response.writeHead(200, { "content-type": "application/json" }); response.end("{"); return; }
			if (request.url === "/delay") { setTimeout(() => { if (!response.destroyed) { response.writeHead(200, { "content-type": "text/plain" }); response.end("late"); } }, 200); return; }
			if (request.url === "/echo-body") {
				const chunks: Buffer[] = [];
				request.on("data", (chunk: Buffer) => chunks.push(chunk));
				request.on("end", () => { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ method: request.method, contentType: request.headers["content-type"], body: Buffer.concat(chunks).toString("utf8") })); });
				return;
			}
			response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ method: request.method, header: request.headers["x-test"] }));
		});
		server = loopbackServer;
		await new Promise<void>((resolve) => loopbackServer.listen(0, "127.0.0.1", resolve));
		const address = loopbackServer.address();
		if (!address || typeof address === "string") throw new Error("loopback listener did not start");
		const baseURL = `http://127.0.0.1:${address.port}`;
		const get = async (path: string, declared: string[], method = "GET") => runtime.callFetch(runtime.resolveFetchUrl(path, baseURL), method, undefined, undefined, {}, { "X-Test": "present" }, declared, { "200": declared, "400": declared });
		expect(await get("/json", ["application/json"])).toEqual({ method: "GET", header: "present" });
		expect(await get("/text", ["text/plain"])).toBe("loopback");
		expect(await get("/empty", [])).toBeUndefined();
		const blob = await get("/blob", ["application/pdf"]) as Blob;
		expect(blob.type).toBe("application/pdf");
		const json = await runtime.callFetch(runtime.resolveFetchUrl("/echo-body", baseURL), "POST", undefined, JSON.stringify({ ok: true }), { "Content-Type": "application/json" }, {}, ["application/json"], { "200": ["application/json"] });
		expect(json).toEqual({ method: "POST", contentType: "application/json", body: '{"ok":true}' });
		const form = await runtime.callFetch(runtime.resolveFetchUrl("/echo-body", baseURL), "POST", undefined, runtime.encodeFetchUrlForm({ tags: ["a", "b"] }), { "Content-Type": "application/x-www-form-urlencoded" }, {}, ["application/json"], { "200": ["application/json"] });
		expect(form).toMatchObject({ contentType: "application/x-www-form-urlencoded", body: "tags=a&tags=b" });
		const multipart = await runtime.callFetch(runtime.resolveFetchUrl("/echo-body", baseURL), "POST", undefined, runtime.encodeFetchMultipart({ name: "value" }), {}, {}, ["application/json"], { "200": ["application/json"] }) as { contentType: string; body: string };
		expect(multipart.contentType).toMatch(/^multipart\/form-data; boundary=/);
		expect(multipart.body).toContain("name=\"name\"");
		await expect(get("/error", ["application/json"], "GET")).rejects.toBeInstanceOf(runtime.FetchHttpError);
		await expect(get("/malformed", ["application/json"])).rejects.toMatchObject({ kind: "decode" });
		await expect(runtime.callFetch(runtime.resolveFetchUrl("/json", baseURL), "GET", undefined, "body", {}, {}, ["application/json"], {})).rejects.toMatchObject({ kind: "configuration" });
		const controller = new AbortController();
		const pending = runtime.callFetch(runtime.resolveFetchUrl("/delay", baseURL), "GET", { signal: controller.signal }, undefined, {}, {}, ["text/plain"], { "200": ["text/plain"] });
		controller.abort();
		await expect(pending).rejects.toMatchObject({ kind: "abort" });
	});

	it("uses browser location fallback and standard Fetch globals", () => {
		vi.stubGlobal("location", { href: "https://browser.example.test/app/" });
		expect(runtime.resolveFetchUrl("../items").href).toBe("https://browser.example.test/items");
		expect(typeof Headers).toBe("function");
		expect(typeof FormData).toBe("function");
		expect(fetchRuntimeSource).not.toMatch(/\b(?:process|Buffer|require|node:|undici)\b/);
	});

	it("keeps HTTP metadata when an error body cannot be decoded", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", { status: 500, headers: { "content-type": "application/json" } })));
		await expect(runtime.callFetch(runtime.resolveFetchUrl("https://example.test/"), "GET", undefined, undefined, {}, {}, ["application/json"], {}))
			.rejects.toMatchObject({ kind: "http", status: 500, body: undefined, response: expect.any(Response), cause: expect.anything() });
	});

	it("classifies cancellation while consuming a response body as abort", async () => {
		const controller = new AbortController();
		let bodyStarted!: () => void;
		const responseBodyStarted = new Promise<void>((resolve) => { bodyStarted = resolve; });
		vi.stubGlobal("fetch", vi.fn(async (_input: URL, init: RequestInit) => new Response(new ReadableStream({
			start(streamController) {
				bodyStarted();
				init.signal?.addEventListener("abort", () => streamController.error(new DOMException("The operation was aborted.", "AbortError")), { once: true });
			},
		}), { headers: { "content-type": "text/plain" } })));
		const pending = runtime.callFetch(runtime.resolveFetchUrl("https://example.test/"), "GET", { signal: controller.signal }, undefined, {}, {}, ["text/plain"], { "200": ["text/plain"] });
		await responseBodyStarted;
		controller.abort();
		await expect(pending).rejects.toMatchObject({ kind: "abort" });
	});

	it("matches declared OpenAPI status ranges", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response('{"ok":true}', { status: 202, headers: { "content-type": "application/json" } })));
		await expect(runtime.callFetch(runtime.resolveFetchUrl("https://example.test/"), "GET", undefined, undefined, {}, {}, [], { "2XX": ["application/json"] }))
			.resolves.toEqual({ ok: true });
	});

	it("matches lowercase OpenAPI status ranges for success and error bodies", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response('{"ok":true}', { status: 202, headers: { "content-type": "application/json" } })));
		await expect(runtime.callFetch(runtime.resolveFetchUrl("https://example.test/"), "GET", undefined, undefined, {}, {}, [], { "2xx": ["application/json"] }))
			.resolves.toEqual({ ok: true });

		vi.stubGlobal("fetch", vi.fn(async () => new Response('{"message":"missing"}', { status: 404, headers: { "content-type": "application/json" } })));
		await expect(runtime.callFetch(runtime.resolveFetchUrl("https://example.test/"), "GET", undefined, undefined, {}, {}, [], { "4xx": ["application/json"] }))
			.rejects.toMatchObject({ kind: "http", status: 404, body: { message: "missing" } });
	});

	it("keeps undeclared HTTP failures as HTTP errors without response-body metadata", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response("unknown error", { status: 418, headers: { "content-type": "text/plain" } })));
		await expect(runtime.callFetch(runtime.resolveFetchUrl("https://example.test/"), "GET", undefined, undefined, {}, {}, ["application/json"], { "200": ["application/json"] }))
			.rejects.toMatchObject({ kind: "http", status: 418, body: undefined, response: expect.any(Response) });
	});
});
