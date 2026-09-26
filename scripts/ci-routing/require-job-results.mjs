import { pathToFileURL } from "node:url";

function parseList(value) {
	return typeof value === "string" && value.length > 0
		? value
				.split(",")
				.map((item) => item.trim())
				.filter(Boolean)
		: [];
}

export function validateRequiredJobResults({
	requiredJobs,
	results,
	classification,
	eventName,
	skippableJobs = [],
}) {
	const fail = (reason) => ({ ok: false, reason });
	if (
		!Array.isArray(requiredJobs) ||
		requiredJobs.length === 0 ||
		new Set(requiredJobs).size !== requiredJobs.length
	)
		return fail("invalid-required-job-list");
	if (!results || typeof results !== "object" || Array.isArray(results))
		return fail("invalid-job-results");
	const actual = Object.keys(results).sort();
	const expected = [...requiredJobs].sort();
	if (JSON.stringify(actual) !== JSON.stringify(expected))
		return fail("required-job-set-mismatch");
	if (
		!classification ||
		typeof classification !== "object" ||
		(classification.route !== "full" && classification.route !== "docs-only")
	)
		return fail("invalid-classification");
	if (
		!Array.isArray(skippableJobs) ||
		new Set(skippableJobs).size !== skippableJobs.length ||
		skippableJobs.some(
			(name) => !requiredJobs.includes(name) || name === "classify-surface",
		)
	)
		return fail("invalid-skippable-job-list");
	const docsOnlyAllowed =
		eventName === "pull_request" &&
		classification.route === "docs-only" &&
		classification.classification === "docs-only" &&
		classification.reason === "trusted-maintainer-docs-only";
	const allowed = new Set(skippableJobs);
	for (const [name, value] of Object.entries(results)) {
		if (!value || typeof value.result !== "string")
			return fail("missing-job-result");
		if (name === "classify-surface") {
			if (value.result !== "success") return fail("classifier-not-successful");
			continue;
		}
		if (docsOnlyAllowed && allowed.has(name)) {
			if (value.result === "skipped") continue;
			return fail(`expected-intentional-skip:${name}:${value.result}`);
		}
		if (value.result === "success") continue;
		return fail(`required-job-not-successful:${name}:${value.result}`);
	}
	return {
		ok: true,
		reason: docsOnlyAllowed
			? "docs-only-skip-authorized"
			: "all-required-jobs-succeeded",
	};
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	let results;
	let classification;
	try {
		results = JSON.parse(process.env.CI_REQUIRED_RESULTS ?? "");
		classification = JSON.parse(process.env.CI_CLASSIFICATION ?? "");
	} catch {
		process.stderr.write("invalid JSON gate input\n");
		process.exit(1);
	}
	const result = validateRequiredJobResults({
		requiredJobs: parseList(process.env.CI_REQUIRED_JOBS),
		results,
		classification,
		eventName: process.env.GITHUB_EVENT_NAME,
		skippableJobs: parseList(process.env.CI_SKIPPABLE_JOBS),
	});
	if (!result.ok) {
		process.stderr.write(`${result.reason}\n`);
		process.exit(1);
	}
	process.stdout.write(`${result.reason}\n`);
}
