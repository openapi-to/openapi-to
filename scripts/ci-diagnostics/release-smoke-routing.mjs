import { pathToFileURL } from "node:url";

const selectedStep = Object.freeze({
	pull_request: { selected: "fast", unselected: "full" },
	merge_group: { selected: "full", unselected: "fast" },
	push: { selected: "full", unselected: "fast" },
});

export function verifyReleaseSmokeRoute({
	eventName,
	fastOutcome,
	fullOutcome,
}) {
	const route = selectedStep[eventName];
	if (!route) throw new Error(`unsupported release smoke event: ${eventName}`);
	const outcomes = { fast: fastOutcome, full: fullOutcome };
	if (outcomes[route.selected] !== "success") {
		throw new Error(
			`selected ${route.selected} packed gate must succeed; got ${outcomes[route.selected] ?? "missing"}`,
		);
	}
	if (outcomes[route.unselected] !== "skipped") {
		throw new Error(
			`unselected ${route.unselected} packed gate must be skipped; got ${outcomes[route.unselected] ?? "missing"}`,
		);
	}
	return { eventName, selected: route.selected, unselected: route.unselected };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		verifyReleaseSmokeRoute({
			eventName: process.env.RELEASE_SMOKE_EVENT,
			fastOutcome: process.env.RELEASE_SMOKE_FAST_OUTCOME,
			fullOutcome: process.env.RELEASE_SMOKE_FULL_OUTCOME,
		});
		console.error(`[release-smoke-routing] PASS ${process.env.RELEASE_SMOKE_EVENT}`);
	} catch (error) {
		console.error(`[release-smoke-routing] FAIL ${error.message}`);
		process.exitCode = 1;
	}
}
