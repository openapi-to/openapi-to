import { appendFile, readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
	boundedSummary,
	evaluate,
	extractRefsHandoff,
	REPOSITORY,
	WORKFLOWS,
} from "./evaluator.mjs";

const API = "https://api.github.com";
const MAX_API_RESPONSE_BYTES = 1_000_000;
const MAX_PAGINATED_RESPONSE_BYTES = 5_000_000;
function fail(reason) {
	return {
		result: "BLOCKED",
		reason,
		recoveryGap:
			"GitHub API 事实不可验证；需人工检查权限或 endpoint 可用性后，通过真实事件或显式运维流程重试。",
	};
}

async function main() {
	const eventPath = process.env.GITHUB_EVENT_PATH;
	const summaryPath = process.env.GITHUB_STEP_SUMMARY;
	let payload;
	try {
		const eventStat = await stat(eventPath);
		if (eventStat.size > MAX_API_RESPONSE_BYTES)
			throw new Error("EVENT_SIZE_LIMIT_EXCEEDED");
		payload = JSON.parse(await readFile(eventPath, "utf8"));
	} catch {
		const result = fail("EVENT_PAYLOAD_INVALID");
		await writeSummary(payload, result, summaryPath);
		return;
	}
	const result = await observe({ env: process.env, payload });
	await writeSummary(payload, result, summaryPath);
}

export async function observe({
	env = process.env,
	payload,
	fetchImpl = globalThis.fetch,
}) {
	if (
		!env.GITHUB_TOKEN ||
		env.GITHUB_REPOSITORY !== REPOSITORY.fullName ||
		env.GITHUB_EVENT_NAME !== "workflow_run"
	) {
		return fail("RUNTIME_CONFIGURATION_INVALID");
	}
	const adapter = createReadOnlyAdapter(env.GITHUB_TOKEN, fetchImpl);
	let result;
	try {
		const repo = await adapter.get(`/repos/${REPOSITORY.fullName}`);
		const eventRun = payload.workflow_run;
		if (!eventRun || !Number.isSafeInteger(eventRun.id)) {
			result = fail("EVENT_RUN_ID_INVALID");
		} else {
			const upstreamRun = await adapter.get(
				`/repos/${REPOSITORY.fullName}/actions/runs/${eventRun.id}`,
			);
			if (
				typeof upstreamRun.head_sha !== "string" ||
				!/^[a-f0-9]{40}$/i.test(upstreamRun.head_sha)
			)
				throw new Error("UPSTREAM_SHA_INVALID");
			const sha = upstreamRun.head_sha;
			const commitPullRequests = await adapter.paginate(
				`/repos/${REPOSITORY.fullName}/commits/${encodeURIComponent(sha)}/pulls?per_page=100`,
			);
			const candidates = [];
			for (const associated of commitPullRequests) {
				if (!Number.isSafeInteger(associated?.number)) continue;
				const [detail, merged] = await Promise.all([
					adapter.get(
						`/repos/${REPOSITORY.fullName}/pulls/${associated.number}`,
					),
					adapter.isMerged(associated.number),
				]);
				candidates.push({ ...detail, merged });
			}
			let issue;
			let blockedBy;
			if (candidates.length === 1) {
				const reference = extractRefsHandoff(candidates[0].body);
				if (Number.isSafeInteger(reference.issueNumber)) {
					const number = reference.issueNumber;
					if (Number.isSafeInteger(number) && number > 0) {
						const [nativeIssue, dependencies] = await Promise.all([
							adapter.get(`/repos/${REPOSITORY.fullName}/issues/${number}`),
							adapter.paginate(
								`/repos/${REPOSITORY.fullName}/issues/${number}/dependencies/blocked_by`,
							),
						]);
						issue = {
							...nativeIssue,
							number: nativeIssue.number,
							repositoryId: repo.id,
						};
						blockedBy = dependencies;
					}
				}
			}
			const workflowRuns = await adapter.paginate(
				`/repos/${REPOSITORY.fullName}/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=100`,
			);
			const jobsByRun = {};
			for (const workflow of WORKFLOWS) {
				const candidatesForWorkflow = workflowRuns.filter(
					(run) =>
						run.workflow_id === workflow.id &&
						run.head_sha === sha &&
						run.event === "push" &&
						run.head_branch === "main",
				);
				candidatesForWorkflow.sort(
					(a, b) =>
						b.run_number - a.run_number ||
						(a.id === b.id ? b.run_attempt - a.run_attempt : b.id - a.id),
				);
				const listed = candidatesForWorkflow[0];
				if (listed) {
					if (
						!Number.isSafeInteger(listed.id) ||
						!Number.isSafeInteger(listed.run_number) ||
						!Number.isSafeInteger(listed.run_attempt)
					)
						throw new Error("CI_RUN_IDENTITY_INVALID");
					const current = await adapter.get(
						`/repos/${REPOSITORY.fullName}/actions/runs/${listed.id}`,
					);
					if (
						current.id !== listed.id ||
						current.workflow_id !== workflow.id ||
						current.name !== workflow.name ||
						current.path !== workflow.path ||
						current.head_sha !== sha ||
						current.event !== "push" ||
						current.head_branch !== "main" ||
						!Number.isSafeInteger(current.run_attempt) ||
						current.run_attempt < 1 ||
						current.run_number !== listed.run_number
					)
						throw new Error("CI_RUN_FRESH_READ_MISMATCH");
					const index = workflowRuns.findIndex((run) => run.id === current.id);
					if (index >= 0) workflowRuns[index] = current;
					jobsByRun[`${current.id}:${current.run_attempt}`] =
						await adapter.paginate(
							`/repos/${REPOSITORY.fullName}/actions/runs/${current.id}/attempts/${current.run_attempt}/jobs?per_page=100`,
						);
					const afterJobs = await adapter.get(
						`/repos/${REPOSITORY.fullName}/actions/runs/${current.id}`,
					);
					if (
						afterJobs.run_attempt !== current.run_attempt ||
						afterJobs.status !== current.status ||
						afterJobs.conclusion !== current.conclusion
					)
						throw new Error("CI_RUN_CHANGED_DURING_READ");
				}
			}
			const verifiedWorkflowRuns = await adapter.paginate(
				`/repos/${REPOSITORY.fullName}/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=100`,
			);
			for (const workflow of WORKFLOWS) {
				const latest = verifiedWorkflowRuns
					.filter(
						(run) =>
							run.workflow_id === workflow.id &&
							run.head_sha === sha &&
							run.event === "push" &&
							run.head_branch === "main",
					)
					.sort(
						(a, b) =>
							b.run_number - a.run_number ||
							(a.id === b.id ? b.run_attempt - a.run_attempt : b.id - a.id),
					)[0];
				if (!latest) continue;
				const previouslyRead = workflowRuns.find((run) => run.id === latest.id);
				if (
					!previouslyRead ||
					previouslyRead.run_attempt !== latest.run_attempt ||
					previouslyRead.status !== latest.status ||
					previouslyRead.conclusion !== latest.conclusion
				) {
					delete jobsByRun[`${latest.id}:${latest.run_attempt}`];
				}
			}
			const currentMain = await adapter.get(
				`/repos/${REPOSITORY.fullName}/commits/main`,
			);
			result = evaluate({
				eventName: env.GITHUB_EVENT_NAME,
				payload,
				repository: repo,
				upstreamRun,
				currentMainSha: currentMain.sha,
				commitPullRequests: candidates,
				workflowRuns: verifiedWorkflowRuns,
				jobsByRun,
				issue,
				blockedBy,
			});
		}
	} catch (error) {
		result = fail(classifyApiError(error));
	}
	return result;
}

export function createReadOnlyAdapter(authToken, fetchImpl = globalThis.fetch) {
	const repositoryPath = `/repos/${REPOSITORY.fullName}`;
	const assertRepositoryPath = (path) => {
		if (typeof path !== "string" || /[\r\n\\#]/.test(path))
			throw new Error("API_PATH_REJECTED");
		const rawPath = path.split(/[?#]/, 1)[0];
		if (rawPath !== repositoryPath && !rawPath.startsWith(`${repositoryPath}/`))
			throw new Error("API_PATH_REJECTED");
		if (/%(?:2f|5c)/i.test(rawPath)) throw new Error("API_PATH_REJECTED");
		let decodedPath;
		try {
			decodedPath = decodeURIComponent(rawPath);
		} catch {
			throw new Error("API_PATH_REJECTED");
		}
		if (
			decodedPath !== repositoryPath &&
			!decodedPath.startsWith(`${repositoryPath}/`)
		)
			throw new Error("API_PATH_REJECTED");
		if (
			decodedPath
				.split("/")
				.some((segment) => segment === "." || segment === "..")
		)
			throw new Error("API_PATH_REJECTED");
		const url = new URL(path, API);
		if (
			url.origin !== API ||
			(url.pathname !== repositoryPath &&
				!url.pathname.startsWith(`${repositoryPath}/`))
		)
			throw new Error("API_PATH_REJECTED");
	};
	const get = async (path) => {
		assertRepositoryPath(path);
		const response = await fetchImpl(`${API}${path}`, {
			method: "GET",
			redirect: "error",
			signal: AbortSignal.timeout(15_000),
			headers: {
				accept: "application/vnd.github+json",
				authorization: `Bearer ${authToken}`,
				"x-github-api-version": "2022-11-28",
			},
		});
		if (!response.ok) throw new Error(`API_READ_FAILED_${response.status}`);
		return readBoundedJson(response);
	};
	const paginate = async (initialPath) => {
		const values = [];
		let totalBytes = 0;
		let path = initialPath;
		for (let page = 0; path && page < 20; page += 1) {
			assertRepositoryPath(path);
			const response = await fetchImpl(`${API}${path}`, {
				method: "GET",
				redirect: "error",
				signal: AbortSignal.timeout(15_000),
				headers: {
					accept: "application/vnd.github+json",
					authorization: `Bearer ${authToken}`,
					"x-github-api-version": "2022-11-28",
				},
			});
			if (!response.ok) throw new Error(`API_READ_FAILED_${response.status}`);
			const { value: data, bytes } = await readBoundedJson(response, true);
			totalBytes += bytes;
			if (totalBytes > MAX_PAGINATED_RESPONSE_BYTES)
				throw new Error("API_TOTAL_SIZE_LIMIT_EXCEEDED");
			const items = Array.isArray(data)
				? data
				: (data.workflow_runs ?? data.jobs ?? []);
			if (!Array.isArray(items)) throw new Error("API_SHAPE_INVALID");
			values.push(...items);
			if (values.length > 2_000) throw new Error("API_RESULT_LIMIT_EXCEEDED");
			const next = response.headers
				.get("link")
				?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
			if (!next) path = "";
			else {
				const url = new URL(next);
				if (url.origin !== API)
					throw new Error("API_PAGINATION_ORIGIN_REJECTED");
				path = `${url.pathname}${url.search}`;
			}
		}
		if (path) throw new Error("API_PAGE_LIMIT_EXCEEDED");
		return values;
	};
	const isMerged = async (number) => {
		if (!Number.isSafeInteger(number) || number < 1)
			throw new Error("PR_ID_INVALID");
		const response = await fetchImpl(
			`${API}/repos/${REPOSITORY.fullName}/pulls/${number}/merge`,
			{
				method: "GET",
				redirect: "error",
				signal: AbortSignal.timeout(15_000),
				headers: {
					authorization: `Bearer ${authToken}`,
					"x-github-api-version": "2022-11-28",
				},
			},
		);
		if (response.status === 204) return true;
		if (response.status === 404) return false;
		throw new Error(`API_READ_FAILED_${response.status}`);
	};
	return Object.freeze({ get, paginate, isMerged });
}

async function readBoundedJson(response, includeSize = false) {
	if (!response.body) throw new Error("API_BODY_MISSING");
	const reader = response.body.getReader();
	const chunks = [];
	let bytes = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		bytes += value.byteLength;
		if (bytes > MAX_API_RESPONSE_BYTES) {
			await reader.cancel();
			throw new Error("API_RESPONSE_SIZE_LIMIT_EXCEEDED");
		}
		chunks.push(Buffer.from(value));
	}
	let value;
	try {
		value = JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
	} catch {
		throw new Error("API_JSON_INVALID");
	}
	return includeSize ? { value, bytes } : value;
}

function classifyApiError(error) {
	const message = String(error?.message ?? "");
	if (
		[
			"UPSTREAM_SHA_INVALID",
			"CI_RUN_IDENTITY_INVALID",
			"CI_RUN_FRESH_READ_MISMATCH",
			"CI_RUN_CHANGED_DURING_READ",
		].includes(message)
	)
		return message;
	const status = message.match(/API_READ_FAILED_(\d{3})/)?.[1];
	return status === "404"
		? "NATIVE_FACT_NOT_FOUND_OR_UNSUPPORTED"
		: "GITHUB_READ_FAILED";
}

async function writeSummary(payload, result, summaryPath) {
	if (!summaryPath) return;
	await appendFile(
		summaryPath,
		boundedSummary({ event: payload, result }),
		"utf8",
	);
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	await main();
}
