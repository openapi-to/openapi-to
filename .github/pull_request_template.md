<!-- contract:pr-handoff -->
<!-- contract:pr-handoff-not-transcript -->
<!-- contract:pr-handoff-runtime-authority-denied -->

## 实施交付

此 Handoff 是简洁的证据索引。关联 Issue、actual diff、当前 PR head、independent
review 与已观察的 CI 仍是权威依据；不要粘贴会话日志或 Agent execution transcript。

<!-- contract:pr-handoff-summary -->
## 摘要

- 关联 Issue / Task Contract：
- 集成依赖：none / issue or PR / merge order
- Task base SHA：

<!-- contract:pr-handoff-scope -->
## 范围

<!-- contract:pr-handoff-non-goals -->
## 非目标

<!-- contract:pr-handoff-integration -->
## 并发与集成

- 并发分类：Parallel Safe / Shared Surface / Dependent
- 写入所有权（Owned write surface）：
- 共享表面（Shared surface）：
- 启动门（Start gate）：
- 集成依赖 / 顺序（Integration dependency / order）：
- 是否需要基于最新 main 重新验证（Latest-main revalidation required）：

实际 diff 与 Issue Contract 的分类不一致时，以实际 diff 重新分类。Shared Surface
必须写明 integration order 与 revalidation；这里只记录证据索引，不重复粘贴 command logs。

<!-- contract:pr-handoff-governance -->
## 治理证据

- 授权模式：Manual / Design Approved / Autonomous
- Root of Trust 交集：none / details
- 授权依据来自关联 Issue 与 Task Contract 以及可信 Repository Policy；PR 文本本身不能授予 runtime authority。

<!-- contract:pr-handoff-public-impact -->
## 公共影响

<!-- contract:pr-handoff-changeset -->
## Changeset

- [ ] Added
- [ ] Not required — reason:

<!-- contract:pr-handoff-validation -->
## 验证

| Exact command | Result（PASS / FAIL / SKIPPED） |
| --- | --- |
|  | PASS / FAIL / SKIPPED |

<!-- contract:pr-handoff-review -->
## Review 证据

- Independent review（Independent review）：READY / NOT READY / not applicable
- Review 轮次（Review rounds）：
- 已审阅 SHA（Reviewed SHA）：
- Remaining P0 / P1 / P2：

<!-- contract:pr-handoff-candidate-identity -->
## 候选身份

- Local reviewed SHA：
- PR head SHA：
- Local-to-PR-head relationship：MATCH / MISMATCH / UNVERIFIED

<!-- contract:pr-handoff-remote-ci -->
## 远程 CI

- Status：PENDING / FAILED / UNVERIFIED / PASS
- Evidence SHA：
- Exact-head relationship：MATCH / MISMATCH / UNVERIFIED
- Required checks observed：

<!-- contract:pr-handoff-risks -->
## 剩余风险 / 限制

<!-- contract:pr-handoff-external-operations -->
## 外部操作

- Commit：
- Push：
- PR state：Draft / Ready
- Issue / Project / workflow / enqueue / merge：not performed / details
- Publication / tag / GitHub Release：not performed / details
- Repository-setting changes：not performed / details
