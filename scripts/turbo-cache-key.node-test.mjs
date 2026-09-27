import assert from "node:assert/strict";
import test from "node:test";

import { createTurboCacheKeys } from "./turbo-cache-key.mjs";

const base = {
	os: "Linux",
	arch: "X64",
	nodeVersion: "v22.20.0",
	pnpmVersion: "11.26.0",
	turboVersion: "2.10.12",
	lockfileContents: "lockfileVersion: '9.0'\nimporters: {}\n",
	sha: "0123456789abcdef0123456789abcdef01234567",
};

test("cache keys isolate OS and architecture", () => {
	const linux = createTurboCacheKeys(base);
	const windows = createTurboCacheKeys({ ...base, os: "Windows" });
	const arm = createTurboCacheKeys({ ...base, arch: "ARM64" });
	assert.notEqual(linux.cacheKey, windows.cacheKey);
	assert.notEqual(linux.restorePrefix, arm.restorePrefix);
	assert.match(linux.restorePrefix, /-Linux-X64-/);
});

test("cache key and restore prefix bind Node, pnpm, Turbo, and lockfile", () => {
	const baseline = createTurboCacheKeys(base);
	for (const patch of [
		{ nodeVersion: "v22.21.0" },
		{ pnpmVersion: "11.27.0" },
		{ turboVersion: "2.11.0" },
		{ lockfileContents: `${base.lockfileContents}# changed\n` },
	]) {
		const changed = createTurboCacheKeys({ ...base, ...patch });
		assert.notEqual(changed.restorePrefix, baseline.restorePrefix);
	}
	assert.match(baseline.cacheKey, /-0123456789abcdef0123456789abcdef01234567$/);
	assert.ok(baseline.cacheKey.startsWith(baseline.restorePrefix));
});

test("restore prefix is bounded to one compatible toolchain and omits the SHA", () => {
	const keys = createTurboCacheKeys(base);
	assert.ok(keys.restorePrefix.endsWith("-"));
	assert.ok(!keys.restorePrefix.includes(base.sha));
	assert.match(
		keys.restorePrefix,
		/^openapi-to-turbo-v1-Linux-X64-node-22\.20\.0-pnpm-11\.26\.0-turbo-2\.10\.12-lock-[0-9a-f]{64}-$/,
	);
});

test("cache key rejects unsafe values and incomplete inputs", () => {
	assert.throws(() => createTurboCacheKeys({ ...base, os: "../../main" }));
	assert.throws(() => createTurboCacheKeys({ ...base, nodeVersion: "latest" }));
	assert.throws(() => createTurboCacheKeys({ ...base, sha: "main" }));
	assert.throws(() => createTurboCacheKeys({ ...base, lockfileContents: "" }));
});
