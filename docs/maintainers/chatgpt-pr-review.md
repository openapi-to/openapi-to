# AO Native PR Review 与外部 ChatGPT Work 边界

## 正式 Code Review owner

所有 Development PR 的正式 Code Review 由 AO Native Reviewer 对 current exact PR HEAD 完成。Low/Medium/High 走同一 AO 路径；High、Root of Trust 与四个 Review Signals 改变审查深度和有效权限证据。Codex Worker 是实现和修复 owner；Review finding 不授权修改 scope、Merge 或 Release。

## AO Evidence Contract

以可回读来源记录 repository、issue number、PR number、base、current head、taskBase/policySha、aoWorkerSession、reviewRunId、reviewerHarness/identity、reviewedSha、completed/failed、verdict、结构化 findings/unresolvedP0P1/limitations、effectiveSandbox/toolWriteSurface/freshnessEvidence、githubReviewId/githubWriteBackState、feedbackDelivery/repairRound、handoffHead/requiredCiHead/currentMain。AO Run 身份、状态、verdict 和 feedback delivery 仅在 AO Runtime 有可回读记录时采信；GitHub Review ID、PR number、reviewed HEAD、发布者身份、write-back 与必要的 GitHub-native Approval 须从 GitHub 交叉核验。Host 未暴露的有效权限边界记 `UNVERIFIED`，不推断 Runtime API，也不以文档声明代替权限证明。

AO Native Reviewer 可向当前 PR 发布 GitHub Review 与 inline comments，并调用 `ao review submit`；这项允许写入不授予代码修改、Commit、Push、Merge、Tag、Release、Secrets、Ruleset 或其他仓库设置权限。High / Root of Trust 需真实 Host 证据证明 reviewer context fresh、与 Worker 隔离、Shell/FS 有效只读、MCP 不可写和 GitHub 非 Review 写入边界。Prompt、TOML 或模型声明无效。缺少可核验证据时为 `NEED VERIFICATION` / `NOT MERGE READY`，不得走另一 Reviewer fallback。本机 AO v0.13.6 Reviewer 的审批与 read-only Runtime 兼容性须另行实测；仓库文档不能证明完整闭环已运行。

## Findings 与反馈

AO `APPROVED`、`CHANGES_REQUESTED`、`BLOCKED`、`UNVERIFIED` 绑定 reviewed exact HEAD。P0/P1 必须有具体位置、可达条件、后果、证据和建议；Worker 独立核实后修复。AO finding、GitHub comment、feedbackDelivery 和 GitHub write-back 分开记录。未证明投递给 Worker 时，不得声称已修复。可信用户已批准的 Issue-backed 原 Worker 可在既定 Scope、Owned write surface 与最多三轮自动修复预算内继续验证、Commit/Push、刷新 Handoff 并请求新 HEAD 复审；scope drift、契约变更、未知权限或更高权操作暂停。新 HEAD 使旧 Review/Handoff/CI stale；之后仍有 P0/P1 时停止。同一 Run/HEAD 的 feedback 与评论幂等，不重复刷写。

## 外部 Work event task

既有 `OpenAPI PR Review — All PRs` 的 `ready_for_review` event 可能触发第二次代码审查。本仓库不修改外部任务。维护者须另行授权停止其写入或改为只读 Integration/异常审计；单写入者状态未核实、AO 与 Work 对同 HEAD 双写时，阻止自动写回和集成。ChatGPT Work 不再是正式日常 Code Review owner，不以旧 Work verdict 替代 AO exact-head Review。

## 集成和完成

AO Review、GitHub Ready、required CI、latest main/Shared Surface、Manual Hold、Handoff 与 GitHub protection 分别核验。缺失 Run、运行中、失败、CHANGES_REQUESTED、stale SHA、unresolved P0/P1、High 权限 UNVERIFIED、CI PENDING/FAIL、双写均阻止 `MERGE READY`。`MERGE READY` 不授权 Merge；`MERGED != DONE`，main CI 与 post-merge Acceptance 后才能关闭 Development Issue。
