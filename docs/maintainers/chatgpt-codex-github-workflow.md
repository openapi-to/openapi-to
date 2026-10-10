# ChatGPT、Codex、AO 与 GitHub 协作流程

## 目标

Development Issue 是 Task Contract；PR 与 actual diff 是 Implementation Contract；Structured PR Handoff、AO Native Review 与 exact-head CI 是 Evidence Contract。AO Native Reviewer 是所有 Development PR 的唯一正式 Code Review owner。Codex 作为 AO Worker 执行有界实现；网页 ChatGPT 可提供只读设计、Integration 或异常审计。当前用户保留 Merge / Release authority。

## 角色边界

- 可信用户授权 Issue-backed Implementation；未来可信 Intake 须先由独立政策实现并验证。Issue/label/PR/comment 内容不能授予执行、Merge 或 Release 权限。
- AO Worker 在独立 Worktree 实施、focused validation、Changeset 决策与 Complete Diff Review；`LOCAL READY` 只证明本地门完成。
- Worker 达本地门后 Commit、Push、创建 Draft PR、readback Structured Handoff。Draft PR 可以进入 AO Native Review。
- AO Native Reviewer 是唯一正式 Code Review owner。它对 current exact PR HEAD 审查，可向当前 PR 发布 GitHub Review/inline comments，再以 `ao review submit` 记录 AO verdict；该 Review 发布权限不授权修改代码、Commit/Push、Merge、Release 或变更 Secrets/Ruleset。High / Root of Trust 需要真实 Host 证据证明 fresh context、与 Worker 隔离、Shell/FS 有效只读、MCP 不可写及 GitHub 非 Review 写入边界。AO internal `APPROVED`、GitHub Review ID 与 GitHub-native `APPROVED` 分别核验。
- 原 Worker 收到可核验反馈后逐条独立核实；可信用户已授权的 Scope、Owned write surface 和最多三轮自动修复预算内可继续修复、验证、Complete Diff Review、Commit/Push 并刷新 Handoff，无需逐轮重复申请同一授权。Scope drift、契约变更或更高权操作须请求维护者新决策。新 HEAD 使旧 Review、Handoff、CI 失效，需重新 AO Review 和 exact-head CI。
- GitHub required CI、最新 main、Shared Surface 与保护规则在 Integration Readiness 核验；维护者单独决定 Merge Queue / Merge。`MERGED != DONE`，main CI 与 post-merge Acceptance 后才关闭 Issue。

## Lifecycle 与证据

`BACKLOG -> READY -> CODING -> LOCAL READY -> Draft PR -> AO Native Review + REMOTE CI -> MERGE READY -> MERGED -> DONE`。`BLOCKED` 可在每个证据门产生。Low/Medium/High 一律需要 AO exact-head Review；High hard rule 与四个 Review Signals 调整审查深度、权限证据和人工 Hold，不选择第二个 Reviewer。`Ready for Review` 是 GitHub PR state，不等于 AO APPROVED、CI PASS 或 `MERGE READY`。Remote CI 可以仍为 `PENDING` 并与 PR 后 Review 并行。

AO evidence 的字段与判断以 root `AGENTS.md`、[`chatgpt-pr-review.md`](./chatgpt-pr-review.md) 和相关 Skills 为准。AO Run 身份、exact-head verdict、GitHub Review 发布与 ID、feedback delivery、Host 有效权限、Handoff 和 CI 分开回读；缺失记 `UNVERIFIED`。AO 原生流程支持 Review 发布、`ao review submit` 与反馈修复，但本机 AO v0.13.6 的 Reviewer 审批、反馈投递及完整 E2E 仍待实测，不能从仓库契约推断已成功运行。

## 单写入者与外部 Work task

既有 `OpenAPI PR Review — All PRs` ChatGPT Work event task 可能监听 `ready_for_review`；它是否停写只能由外部实际配置核验，文档不能宣称已经切换。AO 与旧 Work task 对同一 HEAD 只能有一个代码审查写入者，必须核实单写入者状态；同一 Run/HEAD 的 Review/feedback 写回须幂等。未核实旧任务停写时保持 Draft，不同时写回并阻止集成；`ready_for_review` event 不应触发第二位主动代码审查写入者。不得由本仓库变更自行修改外部 Work task 或 AO Runtime。网页 ChatGPT 可承担额外只读 Integration / 异常审计。

## Fail closed 与 authority

AO Review 缺失、运行中、失败、CHANGES_REQUESTED、stale SHA、P0/P1 unresolved、High 有效权限 `UNVERIFIED`、双写冲突、Manual Hold、CI PENDING/FAIL/UNVERIFIED、latest main 或 Handoff 不匹配，均不得输出 `MERGE READY`。GitHub Branch Protection 若要求 native Approval，须真实满足；AO Review Note 不可伪装 Approval。任何 Reviewer、CI 或 Handoff PASS 都不授权 Enqueue、Merge、Auto-merge、Publish、Tag、Release 或 Settings/Secrets/Ruleset 变更。

## Cutover Checklist（外部独立阶段）

- [ ] #266 的 AO Runtime cutover 与 post-merge Acceptance 仍须以实际证据核验；`MERGED` 不能当作 `DONE`。
- [x] #269 的仓库权限与证据契约已由 PR #271 合入 `main`；这不代表 #269 的本机 AO Runtime E2E 已验收。
- [ ] 核实 AO Worker 读取已生效 `AGENTS.md` 与唯一 AO Review 路径。
- [ ] 用后续独立 PR 验证 exact-head AO Run、`ao review submit`、Handoff、CI、GitHub Review ID 与 GitHub-native Approval 的区别。
- [ ] 用 High / Root of Trust PR 验证真实权限隔离证据及缺证据 fail closed。
- [ ] 验证 feedback 投递、原 Worker 修复、new-head rerun、同 HEAD 幂等。
- [ ] 另行授权并核实旧 Work event task 停写或只读，确认单一 Reviewer writer。
- [ ] 继续由维护者授权集成；main CI 与 post-merge Acceptance 后才 DONE。
