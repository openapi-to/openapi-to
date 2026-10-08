import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
	boundedSummary,
	evaluate,
	REPOSITORY,
	WORKFLOWS,
} from "./evaluator.mjs";
import { createReadOnlyAdapter } from "./observer.mjs";

const sha = "a".repeat(40);
const taskBody = `## 规划元数据\n- 类型：CI / Lifecycle Automation\n## 目标（Goal）\n目标\n## 设计方案（Proposed design）\n设计\n## 范围（Scope）\n范围\n## 非目标（Non-goals）\n非目标\n## 执行/授权模式（Execution / Authorization Mode）\nManual\n## 依赖（Dependencies）\nnone\n## 并发分类（Parallelization）\nShared Surface\n## 冲突表面（Conflict surface）\nworkflow\n## 风险（Risk）\nHigh\n## 验收标准（Acceptance criteria）\n验收\n## 验证预期（Validation expectations）\n验证\n## 写入所有权（Owned write surface）\n路径\n## 启动与集成门（Start / Integration gate）\n启动`;
const handoff = `## 摘要\n- 关联 Issue / Task Contract：Refs #254\n\n## 范围\n`;
const canonicalHandoff = `<!-- contract:pr-handoff -->\n<!-- contract:pr-handoff-summary -->\n${handoff}`;

function run(workflow, overrides = {}) {
	return {
		id: workflow.id * 100,
		run_number: workflow.id,
		workflow_id: workflow.id,
		name: workflow.name,
		path: workflow.path,
		event: "push",
		head_branch: "main",
		head_sha: sha,
		head_repository: { full_name: REPOSITORY.fullName },
		status: "completed",
		conclusion: "success",
		run_attempt: 1,
		created_at: "2026-10-08T00:00:00Z",
		...overrides,
	};
}

function fixture(overrides = {}) {
	const eventRun = run(WORKFLOWS[0]);
	const workflowRuns = WORKFLOWS.map((workflow) => run(workflow));
	const jobsByRun = Object.fromEntries(
		workflowRuns.map((item, index) => [
			`${item.id}:${item.run_attempt}`,
			[
				{
					name: WORKFLOWS[index].aggregateJob,
					status: "completed",
					conclusion: "success",
				},
				...(WORKFLOWS[index].additionalJobs ?? []).map((name) => ({
					name,
					status: "completed",
					conclusion: "success",
				})),
			],
		]),
	);
	const pr = {
		number: 300,
		merged: true,
		merge_commit_sha: sha,
		base: {
			ref: "main",
			repo: { id: REPOSITORY.id, full_name: REPOSITORY.fullName },
		},
		body: canonicalHandoff,
	};
	return {
		eventName: "workflow_run",
		payload: {
			action: "completed",
			workflow_run: { ...eventRun },
			repository: { id: REPOSITORY.id, full_name: REPOSITORY.fullName },
		},
		repository: { id: REPOSITORY.id, full_name: REPOSITORY.fullName },
		upstreamRun: eventRun,
		currentMainSha: sha,
		commitPullRequests: [pr],
		workflowRuns,
		jobsByRun,
		issue: {
			number: 254,
			repositoryId: REPOSITORY.id,
			state: "open",
			body: taskBody,
		},
		blockedBy: [],
		...overrides,
	};
}

test("normal fully populated candidate still blocks on unfrozen trusted acceptance and review evidence", () => {
	const result = evaluate(fixture());
	assert.equal(result.result, "BLOCKED");
	assert.equal(result.reason, "ACCEPTANCE_EVIDENCE_UNVERIFIED");
	assert.deepEqual(result.unprovenGates, [
		"ACCEPTANCE_EVIDENCE_UNVERIFIED",
		"REVIEW_EVIDENCE_UNVERIFIED",
		"POST_MERGE_VALIDATION_UNVERIFIED",
	]);
	assert.notEqual(result.result, "WOULD_CLOSE");
});

test("non-target event and other upstream event types are skipped", () => {
	assert.equal(evaluate({ eventName: "push" }).result, "SKIPPED");
	assert.equal(
		evaluate({ eventName: "workflow_run", payload: { action: "requested" } })
			.reason,
		"NON_COMPLETED_WORKFLOW_RUN_ACTION",
	);
	const input = fixture();
	input.upstreamRun.event = "merge_group";
	input.payload.workflow_run.event = "merge_group";
	assert.equal(evaluate(input).result, "SKIPPED");
});

test("missing and mismatched repository, workflow, run, event, branch, SHA, and attempt fail closed", () => {
	assert.equal(
		evaluate({ eventName: "workflow_run", payload: { action: "completed" } })
			.reason,
		"EVENT_RUN_MISSING",
	);
	assert.equal(
		evaluate(fixture({ repository: { id: 1, full_name: "attacker/repo" } }))
			.reason,
		"REPOSITORY_MISMATCH",
	);
	const forgedRepository = fixture();
	forgedRepository.payload.repository = { id: 1, full_name: "attacker/repo" };
	assert.equal(evaluate(forgedRepository).reason, "REPOSITORY_MISMATCH");
	for (const [upstreamRun, expected] of [
		[{ ...run(WORKFLOWS[0]), workflow_id: 9 }, "UPSTREAM_WORKFLOW_MISMATCH"],
		[
			{ ...run(WORKFLOWS[0]), name: "attacker workflow" },
			"UPSTREAM_WORKFLOW_MISMATCH",
		],
		[
			{ ...run(WORKFLOWS[0]), path: ".github/workflows/untrusted.yml" },
			"UPSTREAM_WORKFLOW_MISMATCH",
		],
		[{ ...run(WORKFLOWS[0]), head_branch: "feature" }, "NON_TARGET_EVENT"],
		[{ ...run(WORKFLOWS[0]), head_sha: "bad" }, "RUN_IDENTITY_INVALID"],
		[{ ...run(WORKFLOWS[0]), run_attempt: 0 }, "RUN_IDENTITY_INVALID"],
	]) {
		assert.equal(
			evaluate({
				...fixture(),
				upstreamRun,
				payload: {
					action: "completed",
					workflow_run: { ...upstreamRun },
					repository: { id: REPOSITORY.id, full_name: REPOSITORY.fullName },
				},
			}).reason,
			expected,
		);
	}
	const changedPayload = fixture();
	changedPayload.payload.workflow_run.run_attempt = 2;
	assert.equal(evaluate(changedPayload).reason, "RUN_PAYLOAD_API_MISMATCH");
	const missingRepository = fixture();
	missingRepository.repository = null;
	assert.equal(evaluate(missingRepository).reason, "REPOSITORY_MISMATCH");
});

test("API-fresh upstream identity must match the event payload", () => {
	const input = fixture();
	input.upstreamRun.id += 1;
	assert.equal(evaluate(input).reason, "RUN_FRESH_READ_MISMATCH");
});

test("a non-success upstream completion is blocked", () => {
	const input = fixture();
	input.upstreamRun.conclusion = "failure";
	input.payload.workflow_run.conclusion = "failure";
	assert.equal(evaluate(input).reason, "UPSTREAM_CI_FAILED:failure");
});

test("a real but unfinished upstream run waits without polling", () => {
	const input = fixture();
	input.upstreamRun.status = "in_progress";
	input.upstreamRun.conclusion = null;
	input.payload.workflow_run.status = "in_progress";
	input.payload.workflow_run.conclusion = null;
	assert.equal(evaluate(input).result, "WAIT_FOR_MAIN_CI");
	assert.equal(evaluate(input).reason, "UPSTREAM_RUN_NOT_COMPLETED");
});

test("main advancement is stale even when SHA is an ancestor", () => {
	assert.equal(
		evaluate(fixture({ currentMainSha: "b".repeat(40) })).reason,
		"STALE_MAIN",
	);
});

test("only same-SHA push/main runs count; missing required workflow waits", () => {
	const input = fixture();
	input.workflowRuns = input.workflowRuns.filter(
		(item) => item.workflow_id !== WORKFLOWS[2].id,
	);
	assert.equal(evaluate(input).result, "WAIT_FOR_MAIN_CI");
	input.workflowRuns.push(run(WORKFLOWS[2], { event: "merge_group", id: 404 }));
	assert.equal(evaluate(input).result, "WAIT_FOR_MAIN_CI");
});

test("newer pending or failed same-SHA rerun cannot be masked by old success", () => {
	for (const override of [
		{
			status: "in_progress",
			conclusion: null,
			run_attempt: 2,
			run_number: 90_000_000,
			id: 90_000_000,
		},
		{
			status: "completed",
			conclusion: "failure",
			run_attempt: 2,
			run_number: 90_000_000,
			id: 90_000_000,
		},
	]) {
		const input = fixture();
		const newer = run(WORKFLOWS[0], override);
		input.workflowRuns.push(newer);
		input.jobsByRun[`${newer.id}:${newer.run_attempt}`] = [
			{
				name: WORKFLOWS[0].aggregateJob,
				status: "completed",
				conclusion: "success",
			},
		];
		const result = evaluate(input);
		assert.equal(
			result.result,
			override.status === "in_progress" ? "WAIT_FOR_MAIN_CI" : "BLOCKED",
		);
	}
	const newerSuccess = fixture();
	newerSuccess.workflowRuns.push(
		run(WORKFLOWS[0], { run_number: 90_000_000, id: 90_000_000 }),
	);
	assert.equal(evaluate(newerSuccess).reason, "CI_JOBS_UNVERIFIED:Quality");
});

test("missing aggregate and Main-only E2E job fail closed, including illegal skips", () => {
	const input = fixture();
	input.jobsByRun[`${run(WORKFLOWS[0]).id}:1`] = [];
	assert.equal(
		evaluate(input).reason,
		"CI_JOB_MISSING:Quality:Required quality",
	);
	const performance = fixture();
	const e2e = run(WORKFLOWS[1]);
	performance.jobsByRun[`${e2e.id}:1`][1].conclusion = "failure";
	assert.equal(
		evaluate(performance).reason,
		"CI_JOB_CONCLUSION_UNACCEPTED:E2E:MCP performance and bounded stress:failure",
	);
	const skipped = fixture();
	skipped.jobsByRun[`${e2e.id}:1`][0].conclusion = "skipped";
	assert.match(evaluate(skipped).reason, /CI_JOB_CONCLUSION_UNACCEPTED/);
});

test("PR association, base/result, handoff refs, task kind, and blockers fail closed", () => {
	assert.equal(
		evaluate(fixture({ commitPullRequests: [] })).reason,
		"MERGED_PR_NOT_PROVEN",
	);
	const multiple = fixture();
	multiple.commitPullRequests.push({
		...multiple.commitPullRequests[0],
		number: 301,
	});
	assert.equal(evaluate(multiple).reason, "MERGED_PR_ASSOCIATION_AMBIGUOUS");
	const noMerge = fixture();
	noMerge.commitPullRequests[0].merged = false;
	assert.equal(evaluate(noMerge).reason, "MERGED_PR_NOT_PROVEN");
	const wrongBase = fixture();
	wrongBase.commitPullRequests[0].base.ref = "release";
	assert.equal(evaluate(wrongBase).reason, "MERGED_PR_NOT_PROVEN");
	const wrongResult = fixture();
	wrongResult.commitPullRequests[0].merge_commit_sha = "b".repeat(40);
	assert.equal(evaluate(wrongResult).reason, "MERGED_PR_NOT_PROVEN");
	const crossRepository = fixture();
	crossRepository.commitPullRequests[0].base.repo.id += 1;
	assert.equal(evaluate(crossRepository).reason, "PR_BASE_REPOSITORY_MISMATCH");
	const ambiguous = fixture();
	ambiguous.commitPullRequests[0].body = `${canonicalHandoff.replace("\n\n## 范围\n", "\n")}- 关联 Issue / Task Contract：Refs #253\n\n## 范围\n`;
	assert.equal(evaluate(ambiguous).reason, "HANDOFF_REFERENCE_AMBIGUOUS");
	const missingRef = fixture();
	missingRef.commitPullRequests[0].body = `<!-- contract:pr-handoff -->\n<!-- contract:pr-handoff-summary -->\n## 摘要\n- 关联 Issue / Task Contract：none`;
	assert.equal(evaluate(missingRef).reason, "HANDOFF_REFERENCE_AMBIGUOUS");
	const nonCanonical = fixture();
	nonCanonical.commitPullRequests[0].body = handoff;
	assert.equal(evaluate(nonCanonical).reason, "HANDOFF_UNVERIFIED");
	assert.equal(
		evaluate(
			fixture({
				issue: {
					number: 254,
					repositoryId: REPOSITORY.id,
					state: "open",
					body: "not a task",
				},
			}),
		).reason,
		"NOT_DEVELOPMENT_TASK",
	);
	assert.equal(
		evaluate(
			fixture({
				issue: {
					number: 254,
					repositoryId: REPOSITORY.id,
					state: "open",
					body: taskBody.replace(
						"CI / Lifecycle Automation",
						"Umbrella roadmap",
					),
				},
			}),
		).reason,
		"NOT_DEVELOPMENT_TASK",
	);
	assert.equal(
		evaluate(
			fixture({
				issue: {
					number: 254,
					repositoryId: REPOSITORY.id,
					state: "closed",
					body: taskBody,
				},
			}),
		).reason,
		"ISSUE_NOT_OPEN",
	);
	assert.equal(
		evaluate(
			fixture({
				issue: {
					number: 255,
					repositoryId: REPOSITORY.id,
					state: "open",
					body: taskBody,
				},
			}),
		).reason,
		"ISSUE_IDENTITY_UNVERIFIED",
	);
	assert.equal(
		evaluate(fixture({ blockedBy: [{ number: 12 }] })).reason,
		"NATIVE_BLOCKER_PRESENT",
	);
	assert.equal(
		evaluate(fixture({ blockedBy: null })).reason,
		"NATIVE_BLOCKERS_UNVERIFIED",
	);
});

test("duplicate deliveries are deterministically classified", () => {
	const input = fixture();
	assert.deepEqual(evaluate(input), evaluate(structuredClone(input)));
});

test("bounded summary strips markup/control injection and includes outcome plus recovery", () => {
	const summary = boundedSummary({
		event: {
			workflow_run: {
				id: 4,
				run_attempt: 1,
				workflow_id: 9,
				head_sha: `abc\n<script>${"a".repeat(40)}`,
			},
		},
		result: {
			result: "BLOCKED",
			reason: "x\n<script>*oops*",
			recoveryGap: "`injection`".repeat(500),
		},
	});
	assert.ok(summary.length <= 4_000);
	assert.doesNotMatch(summary, /<script>|\n<script>|\*oops\*/);
	assert.match(summary, /只读/);
	assert.match(summary, /Run identity/);
	assert.match(summary, /Verification SHA/);
	assert.match(summary, /Result \/ reason/);
	assert.match(summary, /Recovery gap/);
});

test("runtime API surface is GET-only and workflow permissions have no mutation scopes", async () => {
	const source = await readFile(
		new URL("./observer.mjs", import.meta.url),
		"utf8",
	);
	const workflow = await readFile(
		new URL(
			"../../.github/workflows/post-merge-completion.yml",
			import.meta.url,
		),
		"utf8",
	);
	assert.doesNotMatch(source, /method:\s*["'](?:POST|PATCH|PUT|DELETE)/i);
	assert.match(source, /Object\.freeze\(\{ get, paginate, isMerged \}\)/);
	assert.match(
		workflow,
		/contents:\s*read[\s\S]*actions:\s*read[\s\S]*pull-requests:\s*read[\s\S]*issues:\s*read/,
	);
	assert.doesNotMatch(
		workflow,
		/issues:\s*write|pull-requests:\s*write|actions:\s*write|contents:\s*write|schedule:|workflow_dispatch:/,
	);
	assert.match(workflow, /ref: main/);
	assert.match(workflow, /persist-credentials: false/);
});

test("read-only adapter paginates all pages and rejects external pagination origins", async () => {
	const originalFetch = globalThis.fetch;
	const requests = [];
	try {
		globalThis.fetch = async (url, options) => {
			requests.push({ url: String(url), method: options.method });
			if (requests.length === 1) {
				return new Response(JSON.stringify([{ id: 1 }]), {
					headers: {
						link: '<https://api.github.com/repos/openapi-to/openapi-to/actions/runs?head_sha=x&page=2>; rel="next"',
					},
				});
			}
			return new Response(JSON.stringify([{ id: 2 }]));
		};
		const adapter = createReadOnlyAdapter("fixture-token");
		assert.deepEqual(
			await adapter.paginate(
				"/repos/openapi-to/openapi-to/actions/runs?head_sha=x&page=1",
			),
			[{ id: 1 }, { id: 2 }],
		);
		assert.deepEqual(
			requests.map((item) => item.method),
			["GET", "GET"],
		);
		globalThis.fetch = async () =>
			new Response("[]", {
				headers: { link: '<https://example.invalid/steal>; rel="next"' },
			});
		await assert.rejects(
			adapter.paginate("/repos/openapi-to/openapi-to/actions/runs?page=1"),
			/API_PAGINATION_ORIGIN_REJECTED/,
		);
		await assert.rejects(
			adapter.get("https://example.invalid/steal"),
			/API_PATH_REJECTED/,
		);
		globalThis.fetch = async () => new Response("x".repeat(1_000_001));
		await assert.rejects(
			adapter.get("/repos/openapi-to/openapi-to/issues/254"),
			/API_RESPONSE_SIZE_LIMIT_EXCEEDED/,
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
