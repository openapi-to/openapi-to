import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";

import {
	cleanupReleaseSmokeWorkspace,
	ReleaseSmokeProgress,
	runReleaseSmokeCommand,
} from "./smoke-observability.mjs";

function captureStream() {
	let value = "";
	return {
		write(chunk) {
			value += String(chunk);
		},
		read() {
			return value;
		},
	};
}

test("release smoke phase progress is stderr-only with paired bounded timings", async () => {
	const stderr = captureStream();
	const stdout = "";
	let tick = 1_000_000n;
	const progress = new ReleaseSmokeProgress({
		stderr,
		now: () => {
			tick += 12_340_000n;
			return tick;
		},
	});
	await progress.run("consumer-codegen", async () => "done");

	assert.equal(stdout, "");
	assert.deepEqual(progress.timings, [
		{ phase: "consumer-codegen", durationMs: 12, status: "PASS" },
	]);
	assert.equal(
		stderr.read(),
		"[release-smoke] START consumer-codegen\n[release-smoke] PASS consumer-codegen 0.0s\n",
	);
	assert.ok(progress.timings[0].durationMs <= 2_147_483_647);
});

test("release smoke phases reject unpaired names and record failures", async () => {
	const stderr = captureStream();
	const progress = new ReleaseSmokeProgress({
		stderr,
		now: (() => {
			let now = 0n;
			return () => {
				now += 9_000_000n;
				return now;
			};
		})(),
	});
	assert.throws(
		() => progress.start("pack\nBearer secret"),
		/phase name is invalid/,
	);
	assert.equal(stderr.read(), "");
	assert.throws(() => progress.finish(), /No release smoke phase is active/);
	const childFailure = Object.assign(new Error("child command failed"), {
		exitCode: 7,
	});
	await assert.rejects(
		progress.run("packed-install", () => Promise.reject(childFailure)),
		(error) => {
			assert.equal(error, childFailure);
			return true;
		},
	);
	assert.deepEqual(progress.timings, [
		{ phase: "packed-install", durationMs: 9, status: "FAIL" },
	]);
	assert.match(
		stderr.read(),
		/START packed-install\n\[release-smoke\] FAIL packed-install 0\.0s/,
	);
});

test("release smoke child failures preserve exit status and redact bounded output", () => {
	assert.throws(
		() =>
			runReleaseSmokeCommand(
				process.execPath,
				[
					"-e",
					"process.stdout.write('Bearer test-secret https://private.example/spec?token=hidden'); process.exit(7)",
				],
				process.cwd(),
			),
		(error) => {
			assert.equal(error.exitCode, 7);
			assert.match(error.message, /exited with 7/);
			assert.ok(error.message.length < 5_500);
			assert.doesNotMatch(error.message, /test-secret|private\.example|hidden/);
			assert.match(error.message, /<redacted>/);
			assert.match(error.message, /<url>/);
			return true;
		},
	);
});

test("release smoke cleanup preserves KEEP_RELEASE_SMOKE behavior", async () => {
	const removed = [];
	const stderr = captureStream();
	const removeDirectory = async (...args) => removed.push(args);
	await cleanupReleaseSmokeWorkspace({
		temporaryRoot: "/tmp/release-success",
		keep: false,
		succeeded: true,
		removeDirectory,
		stderr,
	});
	await cleanupReleaseSmokeWorkspace({
		temporaryRoot: "/tmp/release-kept",
		keep: true,
		succeeded: true,
		removeDirectory,
		stderr,
	});
	await cleanupReleaseSmokeWorkspace({
		temporaryRoot: "/tmp/release-failed",
		keep: true,
		succeeded: false,
		removeDirectory,
		stderr,
	});
	assert.deepEqual(removed, [
		["/tmp/release-success", { recursive: true, force: true }],
	]);
	assert.equal(
		stderr.read(),
		"Release smoke workspace retained at /tmp/release-failed\n",
	);

	const child = new EventEmitter();
	child.exitCode = null;
	child.kill = (signal) => {
		assert.equal(signal, "SIGTERM");
		child.exitCode = 0;
		child.emit("exit", 0);
	};
	await cleanupReleaseSmokeWorkspace({
		temporaryRoot: "/tmp/release-child",
		keep: false,
		succeeded: true,
		remoteFixtureChild: child,
		removeDirectory,
		stderr,
	});
	assert.equal(removed.length, 2);
});
