export const REPOSITORY = Object.freeze({
	id: 646310819,
	fullName: "openapi-to/openapi-to",
});

export const WORKFLOWS = Object.freeze([
	{
		id: 83776995,
		name: "Quality",
		path: ".github/workflows/quality.yml",
		aggregateJob: "Required quality",
	},
	{
		id: 83788896,
		name: "E2E",
		path: ".github/workflows/e2e.yaml",
		aggregateJob: "Required E2E",
		additionalJobs: ["MCP performance and bounded stress"],
	},
	{
		id: 319707861,
		name: "A1 cross-platform contracts",
		path: ".github/workflows/a1-cross-platform.yml",
		aggregateJob: "Required A1 cross-platform",
	},
]);

const blocked = (reason, recoveryGap = "") => ({
	result: "BLOCKED",
	reason,
	recoveryGap,
});

const skipped = (reason) => ({ result: "SKIPPED", reason, recoveryGap: "" });

function isDevelopmentTask(body) {
	if (typeof body !== "string" || body.length > 100_000) return false;
	const required = [
		"## 规划元数据",
		"类型：",
		"目标（Goal）",
		"设计方案（Proposed design）",
		"范围（Scope）",
		"非目标（Non-goals）",
		"执行/授权模式（Execution / Authorization Mode）",
		"依赖（Dependencies）",
		"并发分类（Parallelization）",
		"冲突表面（Conflict surface）",
		"风险（Risk）",
		"验收标准（Acceptance criteria）",
		"验证预期（Validation expectations）",
		"写入所有权（Owned write surface）",
		"启动与集成门（Start / Integration gate）",
	];
	const declaredType = body.match(/^\s*-\s*类型\s*[:：]\s*([^\n]+)/m)?.[1];
	return (
		typeof declaredType === "string" &&
		required.every((heading) => body.includes(heading)) &&
		!/umbrella|roadmap|blocker/i.test(declaredType)
	);
}

export function extractRefsHandoff(body) {
	if (typeof body !== "string" || body.length > 65_536)
		return { reason: "HANDOFF_UNVERIFIED" };
	if (
		!body.includes("<!-- contract:pr-handoff -->") ||
		!body.includes("<!-- contract:pr-handoff-summary -->")
	)
		return { reason: "HANDOFF_UNVERIFIED" };
	const section = body.match(/## 摘要\s*([\s\S]*?)(?=\n## |$)/)?.[1];
	const lines =
		section
			?.split("\n")
			.filter((item) => /关联 Issue \/ Task Contract/.test(item)) ?? [];
	if (!lines.length) return { reason: "HANDOFF_REFERENCE_MISSING" };
	if (lines.length !== 1) return { reason: "HANDOFF_REFERENCE_AMBIGUOUS" };
	const [line] = lines;
	const match = line.match(
		/^\s*-\s*关联 Issue \/ Task Contract\s*[:：]\s*Refs #(\d+)(?:（Development Task 不使用 Closes\/Fixes\/Resolves）)?\s*$/,
	);
	if (!match) return { reason: "HANDOFF_REFERENCE_AMBIGUOUS" };
	const issueNumber = Number(match[1]);
	if (!Number.isSafeInteger(issueNumber) || issueNumber < 1)
		return { reason: "HANDOFF_REFERENCE_AMBIGUOUS" };
	return { issueNumber };
}

function validIdentity({ payload, upstreamRun, repository }) {
	const eventRun = payload?.workflow_run;
	if (!eventRun || typeof eventRun !== "object") return "EVENT_RUN_MISSING";
	if (
		repository?.id !== REPOSITORY.id ||
		repository?.full_name !== REPOSITORY.fullName ||
		payload?.repository?.id !== REPOSITORY.id ||
		payload?.repository?.full_name !== REPOSITORY.fullName
	)
		return "REPOSITORY_MISMATCH";
	if (
		!Number.isSafeInteger(eventRun.id) ||
		!Number.isSafeInteger(eventRun.run_attempt) ||
		eventRun.run_attempt < 1 ||
		!Number.isSafeInteger(eventRun.workflow_id) ||
		typeof eventRun.head_sha !== "string" ||
		!/^[a-f0-9]{40}$/i.test(eventRun.head_sha)
	)
		return "RUN_IDENTITY_INVALID";
	if (!upstreamRun || upstreamRun.id !== eventRun.id)
		return "RUN_FRESH_READ_MISMATCH";
	if (
		upstreamRun.run_attempt !== eventRun.run_attempt ||
		upstreamRun.workflow_id !== eventRun.workflow_id ||
		upstreamRun.head_sha !== eventRun.head_sha ||
		upstreamRun.event !== eventRun.event ||
		upstreamRun.head_branch !== eventRun.head_branch ||
		upstreamRun.status !== eventRun.status ||
		upstreamRun.conclusion !== eventRun.conclusion
	)
		return "RUN_PAYLOAD_API_MISMATCH";
	const identity = WORKFLOWS.find(
		(item) => item.id === upstreamRun.workflow_id,
	);
	if (
		!identity ||
		upstreamRun.name !== identity.name ||
		upstreamRun.path !== identity.path
	)
		return "UPSTREAM_WORKFLOW_MISMATCH";
	if (upstreamRun.event !== "push" || upstreamRun.head_branch !== "main")
		return "NON_TARGET_EVENT";
	if (
		!upstreamRun.head_repository ||
		upstreamRun.head_repository.full_name !== REPOSITORY.fullName
	)
		return "UPSTREAM_REPOSITORY_MISMATCH";
	if (!Number.isSafeInteger(upstreamRun.id) || upstreamRun.id <= 0)
		return "RUN_ID_INVALID";
	return "";
}

function latestRun(runs, workflow, verificationSha) {
	const applicable = runs.filter(
		(run) =>
			run?.workflow_id === workflow.id &&
			run.path === workflow.path &&
			run.name === workflow.name &&
			run.event === "push" &&
			run.head_branch === "main" &&
			run.head_sha === verificationSha,
	);
	if (
		applicable.some(
			(run) =>
				!Number.isSafeInteger(run.id) ||
				!Number.isSafeInteger(run.run_number) ||
				run.run_number < 1 ||
				!Number.isSafeInteger(run.run_attempt) ||
				run.run_attempt < 1,
		)
	)
		return { invalidIdentity: true };
	applicable.sort((a, b) => {
		const runNumber = b.run_number - a.run_number;
		return (
			runNumber || (a.id === b.id ? b.run_attempt - a.run_attempt : b.id - a.id)
		);
	});
	return applicable[0];
}

function evaluateCi(runs, jobsByRun, sha) {
	if (!Array.isArray(runs))
		return { status: "BLOCKED", reason: "CI_RUNS_UNVERIFIED" };
	const boundRuns = runs.filter((run) => run?.head_sha === sha);
	const state = {};
	for (const workflow of WORKFLOWS) {
		const run = latestRun(boundRuns, workflow, sha);
		if (run?.invalidIdentity)
			return {
				status: "BLOCKED",
				reason: `CI_RUN_IDENTITY_INVALID:${workflow.name}`,
			};
		if (!run)
			return {
				status: "WAIT_FOR_MAIN_CI",
				reason: `CI_RUN_MISSING:${workflow.name}`,
			};
		if (
			["queued", "in_progress", "waiting", "requested", "pending"].includes(
				run.status,
			)
		)
			return {
				status: "WAIT_FOR_MAIN_CI",
				reason: `CI_PENDING:${workflow.name}`,
			};
		if (run.status !== "completed")
			return {
				status: "BLOCKED",
				reason: `CI_STATUS_UNACCEPTED:${workflow.name}`,
			};
		if (run.conclusion !== "success")
			return {
				status: "BLOCKED",
				reason: `CI_CONCLUSION_UNACCEPTED:${workflow.name}:${run.conclusion ?? "missing"}`,
			};
		const jobs = jobsByRun?.[`${run.id}:${run.run_attempt}`];
		if (!Array.isArray(jobs))
			return {
				status: "BLOCKED",
				reason: `CI_JOBS_UNVERIFIED:${workflow.name}`,
			};
		const required = [
			workflow.aggregateJob,
			...(workflow.additionalJobs ?? []),
		];
		for (const name of required) {
			const matches = jobs.filter((job) => job?.name === name);
			if (matches.length !== 1) {
				return {
					status: "BLOCKED",
					reason: matches.length
						? `CI_JOB_AMBIGUOUS:${workflow.name}:${name}`
						: `CI_JOB_MISSING:${workflow.name}:${name}`,
				};
			}
			if (matches[0].status !== "completed")
				return {
					status: "WAIT_FOR_MAIN_CI",
					reason: `CI_JOB_PENDING:${workflow.name}:${name}`,
				};
			if (matches[0].conclusion !== "success")
				return {
					status: "BLOCKED",
					reason: `CI_JOB_CONCLUSION_UNACCEPTED:${workflow.name}:${name}:${matches[0].conclusion ?? "missing"}`,
				};
		}
		state[workflow.name] = {
			runId: run.id,
			attempt: run.run_attempt,
			conclusion: run.conclusion,
		};
	}
	return { status: "PASS", state };
}

export function evaluate(input) {
	const { eventName, payload } = input ?? {};
	if (eventName !== "workflow_run") return skipped("NON_TARGET_EVENT");
	if (payload?.action !== "completed")
		return skipped("NON_COMPLETED_WORKFLOW_RUN_ACTION");
	if (!payload?.workflow_run) return blocked("EVENT_RUN_MISSING");
	const identityProblem = validIdentity(input);
	if (identityProblem === "NON_TARGET_EVENT") return skipped(identityProblem);
	if (identityProblem) return blocked(identityProblem);
	const run = input.upstreamRun;
	if (!["queued", "in_progress", "completed"].includes(run.status))
		return blocked("RUN_STATUS_INVALID");
	if (run.status !== "completed")
		return {
			result: "WAIT_FOR_MAIN_CI",
			reason: "UPSTREAM_RUN_NOT_COMPLETED",
			recoveryGap: "",
		};
	if (run.conclusion !== "success")
		return {
			...blocked(`UPSTREAM_CI_FAILED:${run.conclusion ?? "missing"}`),
			ci: { upstream: run.conclusion ?? "missing" },
		};
	const sha = run.head_sha;
	if (input.currentMainSha !== sha)
		return blocked(
			"STALE_MAIN",
			"当前 main 已前进；需显式重新读取 main 与同一候选的最新 CI/PR/Issue 事实后恢复，本次不等待或轮询。",
		);
	if (!Array.isArray(input.commitPullRequests))
		return blocked(
			"COMMIT_PR_ASSOCIATION_UNVERIFIED",
			"需通过 GitHub commit-associated PR API 重新读取关联结果。",
		);
	const candidates = input.commitPullRequests.filter(
		(pr) =>
			pr?.merged === true &&
			pr?.base?.ref === "main" &&
			pr?.base?.repo?.full_name === REPOSITORY.fullName &&
			pr?.merge_commit_sha === sha,
	);
	if (!candidates.length)
		return blocked(
			"MERGED_PR_NOT_PROVEN",
			"没有本次 SHA 的可靠 merged PR 关联；不能按时间或标题猜测。",
		);
	if (candidates.length !== 1)
		return blocked(
			"MERGED_PR_ASSOCIATION_AMBIGUOUS",
			"多个 PR 关联同一提交，需人工核验一对一 Task Contract 关系。",
		);
	const pr = candidates[0];
	if (!Number.isSafeInteger(pr.number) || pr.number < 1)
		return blocked("PR_IDENTITY_UNVERIFIED");
	if (pr.base?.repo?.id !== REPOSITORY.id)
		return blocked("PR_BASE_REPOSITORY_MISMATCH");
	const ref = extractRefsHandoff(pr.body);
	if (ref.reason)
		return blocked(
			ref.reason,
			"需修正并重新审阅 canonical Structured PR Handoff 的明确关联字段。",
		);
	if (
		!input.issue ||
		input.issue.number !== ref.issueNumber ||
		input.issue.repositoryId !== REPOSITORY.id
	)
		return blocked("ISSUE_IDENTITY_UNVERIFIED");
	if (!isDevelopmentTask(input.issue.body))
		return blocked("NOT_DEVELOPMENT_TASK");
	if (input.issue.state !== "open") return blocked("ISSUE_NOT_OPEN");
	if (!Array.isArray(input.blockedBy))
		return blocked(
			"NATIVE_BLOCKERS_UNVERIFIED",
			"需通过 GitHub Issue dependency API 重新读取 blockers。",
		);
	if (input.blockedBy.length) return blocked("NATIVE_BLOCKER_PRESENT");
	const ci = evaluateCi(input.workflowRuns, input.jobsByRun, sha);
	const candidate = { issue: ref.issueNumber, pr: pr.number, sha };
	if (ci.status === "WAIT_FOR_MAIN_CI")
		return {
			result: ci.status,
			reason: ci.reason,
			recoveryGap: "",
			candidate,
			ci: { status: "WAITING", detail: ci.reason },
		};
	if (ci.status === "BLOCKED")
		return {
			...blocked(
				ci.reason,
				"若全部适用 CI 已终结而必要 evidence 缺失，需人工确定恢复动作；不会假设后续事件一定到达。",
			),
			candidate,
			ci: { status: "BLOCKED", detail: ci.reason },
		};
	const unverified = [
		"ACCEPTANCE_EVIDENCE_UNVERIFIED",
		"REVIEW_EVIDENCE_UNVERIFIED",
		"POST_MERGE_VALIDATION_UNVERIFIED",
	];
	return {
		result: "BLOCKED",
		reason: unverified[0],
		candidate,
		ci: ci.state,
		unprovenGates: unverified,
		recoveryGap:
			"阶段二尚未冻结可信 AC 验收来源；当前无法验证完整 AC 覆盖、合法 Independent Review、post-merge validation provenance 与 blocker/Unknown 状态。CI 全绿仍不能输出 WOULD_CLOSE。",
	};
}

export function boundedSummary({ event, result }) {
	const safe = (value, max = 180) =>
		Array.from(String(value ?? "unknown"), (character) => {
			const codePoint = character.codePointAt(0);
			return codePoint < 32 || codePoint === 127 ? " " : character;
		})
			.join("")
			.replace(/[<>`*_{}!|#\\]/g, "")
			.replace(/[\u005b\u005d]/g, "")
			.replace(/\s+/g, " ")
			.slice(0, max);
	const candidate = result.candidate ?? {};
	const ci = result.ci ?? {};
	const lines = [
		"## Post-Merge Completion Observer（只读）",
		"",
		`- Run identity：${safe(event?.workflow_run?.id)} / attempt ${safe(event?.workflow_run?.run_attempt)} / workflow ${safe(event?.workflow_run?.workflow_id)}`,
		`- Verification SHA：${safe(event?.workflow_run?.head_sha, 40)}`,
		`- Candidate：Issue #${safe(candidate.issue)} / PR #${safe(candidate.pr)}`,
		`- Main CI：${safe(JSON.stringify(ci), 600)}`,
		`- Unproven gates：${safe((result.unprovenGates ?? []).join(", ") || "none recorded", 400)}`,
		`- Result / reason：${safe(result.result)} / ${safe(result.reason)}`,
		`- Recovery gap：${safe(result.recoveryGap || "none", 500)}`,
		"",
		"此 observer 只分类证据，不执行 Issue、PR 或 Label 写入；本次运行不是 Issue DONE 证明。",
	];
	return `${lines.join("\n")}\n`.slice(0, 4_000);
}
