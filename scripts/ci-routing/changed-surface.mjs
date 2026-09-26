import { execFile } from "node:child_process";
import { appendFile, readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SHA = /^[0-9a-f]{40}$/i;
const MAX_EVENT_BYTES = 1024 * 1024;

const SURFACES = [
	["maintainer-docs", /^docs\/maintainers\//],
	[
		"release",
		/^(\.changeset\/|scripts\/release\/|\.github\/workflows\/(publish|version-packages|version-readiness)\.)/,
	],
	[
		"a1",
		/^(scripts\/a1-contracts\/|scripts\/run-a1-contracts\.mjs|\.github\/workflows\/a1-cross-platform\.yml$)/,
	],
	["e2e", /^(scripts\/ci-diagnostics\/|\.github\/workflows\/e2e\.yaml$|e2e\/)/],
	[
		"workflow",
		/^(\.github\/|\.agents\/skills\/|scripts\/ci-routing\/|scripts\/repository-contract)/,
	],
	["core", /^packages\/core\//],
	["cli", /^(packages\/cli\/|packages\/openapi\/)/],
	["mcp", /^packages\/mcp\//],
	["plugin", /^packages\/plugin-[^/]+\//],
	[
		"root-config",
		/^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|turbo\.json|tsconfig[^/]*\.json|biome\.jsonc?|\.npmrc|\.node-version)$/,
	],
];

function sha(value) {
	return typeof value === "string" && SHA.test(value) ? value : undefined;
}

function surfaceFor(file) {
	for (const [surface, pattern] of SURFACES) {
		if (pattern.test(file)) return surface;
	}
	return "unknown";
}

function writeOutputs(outputPath, result) {
	if (!outputPath) return;
	const classification = JSON.stringify({
		route: result.route,
		classification: result.classification,
		reason: result.reason,
	});
	return appendFile(
		outputPath,
		`route=${result.route}\nclassification=${classification}\n`,
	);
}

export async function classifyChangedSurface({
	eventName,
	eventPath,
	githubSha,
	cwd = process.cwd(),
	exec = execFileAsync,
}) {
	const full = (reason, extra = {}) => ({
		route: "full",
		classification: "full",
		reason,
		files: [],
		surfaces: [],
		...extra,
	});
	if (!eventName || !eventPath) return full("missing-event-context");
	let event;
	try {
		const metadata = await stat(eventPath);
		if (metadata.size > MAX_EVENT_BYTES) return full("oversized-event-payload");
		event = JSON.parse(await readFile(eventPath, "utf8"));
	} catch {
		return full("invalid-event-payload");
	}
	let base;
	let head;
	if (eventName === "pull_request") {
		base = sha(event.pull_request?.base?.sha);
		head = sha(event.pull_request?.head?.sha);
	} else if (eventName === "merge_group") {
		base = sha(event.merge_group?.base_sha);
		head = sha(event.merge_group?.head_sha);
		if (!head || head !== sha(githubSha))
			return full("merge-group-head-mismatch");
	} else if (eventName === "push") {
		base = sha(event.before);
		head = sha(githubSha);
	} else {
		return full("event-requires-full", { event: eventName });
	}
	if (!base || !head)
		return full("missing-or-invalid-sha", { event: eventName });
	try {
		await exec("git", ["cat-file", "-e", `${base}^{commit}`], { cwd });
		await exec("git", ["cat-file", "-e", `${head}^{commit}`], { cwd });
		const { stdout } = await exec(
			"git",
			["diff", "--name-status", "-z", "--find-renames", base, head, "--"],
			{ cwd, maxBuffer: 4 * 1024 * 1024 },
		);
		const records = stdout.split("\0").filter(Boolean);
		const files = [];
		for (let index = 0; index < records.length; ) {
			const status = records[index++];
			if (!/^(?:A|M|T|D)$/.test(status))
				return full("unsupported-change-status");
			const file = records[index++];
			if (!file || file.startsWith("/") || file.split("/").includes(".."))
				return full("invalid-changed-path");
			files.push({ status, path: file });
		}
		if (files.length === 0 || files.length > 5000)
			return full("empty-or-oversized-diff", { base, head });
		const surfaces = [
			...new Set(files.map(({ path }) => surfaceFor(path))),
		].sort();
		const docsOnly =
			eventName === "pull_request" &&
			files.every(
				({ status, path }) =>
					(status === "A" || status === "M") &&
					/^docs\/maintainers\/(?:[^/]+\/)*[^/]+\.md$/.test(path),
			);
		return {
			route: docsOnly ? "docs-only" : "full",
			classification: docsOnly ? "docs-only" : "full",
			reason: docsOnly
				? "trusted-maintainer-docs-only"
				: "non-docs-or-universal-event",
			event: eventName,
			base,
			head,
			files,
			surfaces,
		};
	} catch {
		return full("git-range-unavailable", { event: eventName, base, head });
	}
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	const result = await classifyChangedSurface({
		eventName: process.env.GITHUB_EVENT_NAME,
		eventPath: process.env.GITHUB_EVENT_PATH,
		githubSha: process.env.GITHUB_SHA,
	});
	await writeOutputs(process.env.GITHUB_OUTPUT, result);
	process.stdout.write(
		`${JSON.stringify({ route: result.route, reason: result.reason, surfaces: result.surfaces })}\n`,
	);
}
