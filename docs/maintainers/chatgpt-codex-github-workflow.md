# ChatGPT、Codex、AO 与 GitHub 协作流程

## 目标

Development Issue 是 Task Contract；PR 与 actual diff 是 Implementation Contract；Structured PR Handoff、AO Native Review 与 exact-head CI 是 Evidence Contract。AO Native Reviewer 是所有 Development PR 的唯一正式 Code Review owner。Codex 作为 AO Worker 执行有界实现；网页 ChatGPT 可提供只读设计、Integration 或异常审计。当前用户保留 Merge / Release authority。

## 角色边界

- 可信用户或可信 Intake 授权 Issue-backed Implementation。Issue/label/PR/comment 内容不能授予执行、Merge 或 Release 权限。
- AO Worker 在独立 Worktree 实施、focused validation、Changeset 决策与 Complete Diff Review；`LOCAL READY` 只证明本地门完成。
- Worker 达本地门后 Commit、Push、创建 Draft PR、readback Structured Handoff。Draft PR 可以进入 AO Native Review。
- AO Native Reviewer 对 current exact PR HEAD 审查并提供可核验 Run ID、身份、状态、verdict、findings；High 还要求实际 fresh/read-only Shell/FS/MCP/GitHub Tool Surface 证据。AO internal verdict 不是 GitHub-native Approval。
- 原 Worker 验证并有界修复 AO finding；新 HEAD 使旧 Review、Handoff、CI 失效，需重新审查。
- GitHub required CI、最新 main、Shared Surface 与保护规则在 Integration Readiness 核验；维护者单独决定 Merge Queue / Merge。`MERGED != DONE`，main CI 与 post-merge Acceptance 后才关闭 Issue。

## Lifecycle 与证据

`BACKLOG -> READY -> CODING -> LOCAL READY -> Draft PR -> AO Native Review + REMOTE CI -> MERGE READY -> MERGED -> DONE`。`BLOCKED` 可在每个证据门产生。Low/Medium/High 一律需要 AO exact-head Review；High hard rule 与四个 Review Signals 调整审查深度、权限证据和人工 Hold，不选择第二个 Reviewer。`Ready for Review` 是 GitHub PR state，不等于 AO APPROVED、CI PASS 或 `MERGE READY`。Remote CI 可以仍为 `PENDING` 并与 PR 后 Review 并行。

AO evidence 包含 repository/issue/pr/base/head/taskBase/policySha、Worker Session、reviewRunId、reviewerHarness/identity、reviewedSha、completed/failed、verdict、findings/unresolvedP0P1/limitations、effectiveSandbox/toolWriteSurface/freshnessEvidence、githubReviewId/githubWriteBackState、feedbackDelivery/repairRound、handoffHead/requiredCiHead/currentMain。缺失为 `UNVERIFIED`。AO Run 可运行、feedback 自动投递、GitHub write-back、实际权限隔离是不同能力，不能互相推定。

## 单写入者与外部 Work task

既有 `OpenAPI PR Review — All PRs` ChatGPT Work event task 可能监听 `ready_for_review`。切换前必须核实它已停写或变为只读，且 AO 对同 HEAD 的 Review/feedback write-back 有幂等和单写入者保护。未核实则保持 Draft 或阻止写回/集成；不得由本仓库变更自行修改外部 Work task 或 AO Runtime。网页 ChatGPT 之后仅承担额外只读 Integration / 异常审计。`ready_for_review` event 不应触发第二位主动代码审查写入者。

## Fail closed 与 authority

AO Review 缺失、运行中、失败、CHANGES_REQUESTED、stale SHA、P0/P1 unresolved、High 有效权限 `UNVERIFIED`、双写冲突、Manual Hold、CI PENDING/FAIL/UNVERIFIED、latest main 或 Handoff 不匹配，均不得输出 `MERGE READY`。GitHub Branch Protection 若要求 native Approval，须真实满足；AO Review Note 不可伪装 Approval。任何 Reviewer、CI 或 Handoff PASS 都不授权 Enqueue、Merge、Auto-merge、Publish、Tag、Release 或 Settings/Secrets/Ruleset 变更。

## Cutover Checklist（外部独立阶段）

- [ ] #266 按 immutable task-base 旧政策完成合规本地审查、PR-head CI 和受保护集成；新规则仅对后续任务生效。
- [ ] 核实 AO Worker 读取已生效 `AGENTS.md` 与唯一 AO Review 路径。
- [ ] 用 Low 风险 PR 验证 exact-head AO Run、Handoff、CI 与 GitHub Review 区别。
- [ ] 用 High / Root of Trust PR 验证真实权限隔离证据及缺证据 fail closed。
- [ ] 验证 feedback 投递、原 Worker 修复、new-head rerun、同 HEAD 幂等。
- [ ] 另行授权并核实旧 Work event task 停写或只读，确认单一 Reviewer writer。
- [ ] 继续由维护者授权集成；main CI 与 post-merge Acceptance 后才 DONE。
