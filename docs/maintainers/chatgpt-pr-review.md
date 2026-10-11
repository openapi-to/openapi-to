# AO Native PR Review 与外部 ChatGPT Work 边界

## 正式 Code Review owner

所有 Development PR 的正式 Code Review 由 AO Native Reviewer 对 current exact PR HEAD 完成。Low/Medium/High 走同一 AO 路径；High、Root of Trust 与四个 Review Signals 改变审查深度；完整 Host 有效权限证据单独按可信 changed-surface 权限敏感性决定。Codex Worker 是实现和修复 owner；Review finding 不授权修改 scope、Merge 或 Release。

## AO Evidence Contract

以可回读来源记录 repository、issue number、PR number、base、current head、taskBase/policySha、aoWorkerSession、reviewRunId、reviewerHarness/identity、reviewedSha、completed/failed、verdict、结构化 findings/unresolvedP0P1/limitations、effectiveSandbox/toolWriteSurface/freshnessEvidence、githubReviewId/githubWriteBackState、feedbackDelivery/repairRound、handoffHead/requiredCiHead/currentMain。候选身份须由 GitHub PR 和 immutable task base/policy 交叉核对；AO Run 身份、状态、verdict 须从 AO 可回读来源采信，不能仅靠 Handoff。`AO_ONLY` 表示未尝试可选 GitHub Review publication，`GITHUB_REVIEW` 表示已发布且 GitHub Review ID、PR number、reviewed HEAD 均经 GitHub 核验；声称发布却缺证据记 `UNVERIFIED`。AO internal `APPROVED` 不等于 GitHub-native Approval；后者只在真实 Ruleset 要求时另行满足。Host 未暴露的有效权限边界记 `UNVERIFIED`，不推断 Runtime API，也不以文档声明代替权限证明。

AO Native Reviewer 可向当前 PR 发布 GitHub Review 与 inline comments，并调用 `ao review submit`；这项允许写入不授予代码修改、Commit、Push、Merge、Tag、Release、Secrets、Ruleset 或其他仓库设置权限。High / Root of Trust 需更深入 AO Review；仅经可信 actual diff 证实为 permission-sensitive 的变更（包括可执行 Root-of-Trust 授权、Reviewer/Agent/CI/Secrets/MCP Write/Queue/Release 权限）强制真实 Host 证据证明 reviewer context fresh、与 Worker 隔离、Shell/FS 有效只读、MCP 不可写和 GitHub 非 Review 写入边界。分类缺失、可信来源不明或与 Root of Trust 授权影响矛盾则 fail closed。未变化的可信已验证 Host baseline 可以复用，但不能靠 Prompt/TOML 或 PR/Handoff 自述；非权限敏感 High 缺完整 Host 证明不单独阻止人工集成，记录残余风险。Prompt、TOML 或模型声明无效。缺少可核验证据时为 `NEED VERIFICATION` / `NOT MERGE READY`，不得走另一 Reviewer fallback。当前 AO Reviewer 的审批与 read-only Runtime 兼容性须按实际 Host 版本另行实测；仓库文档不能证明完整闭环已运行。

## Findings 与反馈

AO `APPROVED`、`CHANGES_REQUESTED`、`BLOCKED`、`UNVERIFIED` 绑定 reviewed exact HEAD。P0/P1 必须有具体位置、可达条件、后果、证据和建议；Worker 独立核实后修复。AO finding、GitHub comment、feedbackDelivery 和 GitHub write-back 分开记录。无 finding 记 `NO_FINDINGS`，不要求空投递；有 finding 须有 AO 原生 `DELIVERED_TO_WORKER` 或 Worker 主动只读拉取 exact Review Run 的 `WORKER_CONSUMED_RUN` 证据。`NOT_DELIVERED` 和 `UNVERIFIED` 不得声称已修复；最终一轮无 finding 不追认历史自动投递。当前 AO 自动注入若依赖已发布的 GitHub inline comments，AO_ONLY 场景的自动投递应记 `AUTOMATIC_DELIVERY_UNVERIFIED`，使用可回读的 Worker 拉取/消费路径。可信用户已批准的 Issue-backed 原 Worker 可在既定 Scope、Owned write surface 与最多三轮自动修复预算内继续验证、Commit/Push、刷新 Handoff 并请求新 HEAD 复审；scope drift、契约变更、未知权限或更高权操作暂停。新 HEAD 使旧 Review/Handoff/CI stale；之后仍有 P0/P1 时停止。同一 Run/HEAD 的 feedback 与评论幂等，不重复刷写。

## 外部 Work event task

维护者已声明既有 `OpenAPI PR Review — All PRs` 不再作为代码审查链路；此 `OPERATOR_RETIRED_ATTESTED` 不等于 `EXTERNALLY_VERIFIED_INACTIVE`。本仓库不修改外部任务；可读取时核验其实际状态，不可读取时记录 `ACTUAL_STATE_UNVERIFIED`，并检查同 HEAD 是否存在双写迹象。单写入者的维护者决策与实际运行状态分别记录；仅缺外部配置回读不永久阻止后续集成，已证实双写立即阻止集成。ChatGPT Work 不再是正式日常 Code Review owner，不以旧 Work verdict 替代 AO exact-head Review。

## 集成和完成

AO Review、GitHub Ready、required CI、latest main/Shared Surface、Manual Hold、Handoff 与 GitHub protection 分别核验。缺失 Run、运行中、失败、CHANGES_REQUESTED、stale SHA、unresolved P0/P1、权限敏感分类或其必需 Host 权限 UNVERIFIED、CI PENDING/FAIL、双写均阻止 `MERGE READY`。`MERGE READY` 不授权 Merge。最终完整 Development PR 使用 `Closes #N`，仅默认分支合并且 Auto-close 设置启用时预期 GitHub 原生关闭；Main CI 故障仍单独诊断。
