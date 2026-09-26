import assert from "node:assert/strict";
import test from "node:test";
import { getPlan } from "./plans.mjs";
import { verifyReleaseSmokeRoute } from "./release-smoke-routing.mjs";

test("the selected route retains the canonical pack-install diagnostics identity", () => {
	const commands = getPlan("quality-release-smoke").commands;
	assert.equal(commands.filter(({ id }) => id === "pack-install").length, 1);
});

test("PR selects Fast and explicitly skips Full", () => {
	assert.deepEqual(
		verifyReleaseSmokeRoute({
			eventName: "pull_request",
			fastOutcome: "success",
			fullOutcome: "skipped",
		}),
		{ eventName: "pull_request", selected: "fast", unselected: "full" },
	);
});

for (const eventName of ["merge_group", "push"]) {
	test(`${eventName} selects Full and explicitly skips Fast`, () => {
		assert.deepEqual(
			verifyReleaseSmokeRoute({
				eventName,
				fastOutcome: "skipped",
				fullOutcome: "success",
			}),
			{ eventName, selected: "full", unselected: "fast" },
		);
	});
}

for (const outcome of ["failure", "cancelled", "skipped", "missing", undefined]) {
	test(`selected PR Fast ${outcome ?? "missing"} fails closed`, () => {
		assert.throws(
			() =>
				verifyReleaseSmokeRoute({
					eventName: "pull_request",
					fastOutcome: outcome,
					fullOutcome: "skipped",
				}),
			/selected fast packed gate must succeed/,
		);
	});
}

test("an unselected gate that runs or is missing fails closed", () => {
	for (const fullOutcome of ["success", "failure", "cancelled", undefined]) {
		assert.throws(
			() =>
				verifyReleaseSmokeRoute({
					eventName: "pull_request",
					fastOutcome: "success",
					fullOutcome,
				}),
			/unselected full packed gate must be skipped/,
		);
	}
});

test("selected Full failure or an unselected Fast success fails closed", () => {
	for (const fullOutcome of ["failure", "cancelled", "skipped", undefined]) {
		assert.throws(
			() =>
				verifyReleaseSmokeRoute({
					eventName: "merge_group",
					fastOutcome: "skipped",
					fullOutcome,
				}),
			/selected full packed gate must succeed/,
		);
	}
	assert.throws(
		() =>
			verifyReleaseSmokeRoute({
				eventName: "push",
				fastOutcome: "success",
				fullOutcome: "success",
			}),
		/unselected fast packed gate must be skipped/,
	);
});

test("unknown event fails closed", () => {
	assert.throws(
		() =>
			verifyReleaseSmokeRoute({
				eventName: "workflow_dispatch",
				fastOutcome: "success",
				fullOutcome: "success",
			}),
		/unsupported release smoke event/,
	);
});
