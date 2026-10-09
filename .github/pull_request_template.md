<!-- contract:pr-handoff -->
<!-- contract:pr-handoff-not-transcript -->
<!-- contract:pr-handoff-runtime-authority-denied -->

## 实施交付

此 Handoff 是简洁的证据索引。关联 Issue、actual diff、当前 PR head、AO Native Review
与已观察的 CI 仍是权威依据；不要粘贴会话日志或 Agent execution transcript。

<!-- contract:pr-handoff-summary -->
## 摘要

- 关联 Issue / Task Contract：Refs #<issue>（Development Task 不使用 Closes/Fixes/Resolves）
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

- High-risk hard rule：YES / NO
- Review signals：
  - external-contract：YES / NO
  - state-side-effects：YES / NO
  - coupling-compatibility：YES / NO
  - evidence-gap：YES / NO
- AO Native Review：APPROVED / CHANGES_REQUESTED / BLOCKED / UNVERIFIED
- AO Worker Session / Review Run ID / Reviewer harness / identity：
- AO reviewed exact PR HEAD（AO reviewed SHA）：SHA / UNVERIFIED — reason
- AO completed/failed status / completedAt：
- Structured findings / review scope / limitations：
- High freshness / effective read-only Shell-FS / MCP-GitHub Tool Surface evidence：VERIFIED / UNVERIFIED — reason
- GitHub Review ID / write-back：AO_ONLY / GITHUB_REVIEW / UNVERIFIED
- GitHub-native required Approval / satisfied：YES / NO / UNVERIFIED
- Feedback delivery / Worker owner / repair round：
- 单写入者状态（AO / 旧 Work event task）：VERIFIED / UNVERIFIED — reason
- Remaining P0 / P1 / P2：

<!-- contract:pr-handoff-candidate-identity -->
## 候选身份

- Repository / Issue number / PR number / base SHA：
- Local reviewed SHA：
- PR head SHA：
- Task base / policy SHA：
- Local-to-PR-head relationship：MATCH / MISMATCH / UNVERIFIED

<!-- contract:pr-handoff-remote-ci -->
## 远程 CI

- Status：PENDING / FAILED / UNVERIFIED / PASS
- Evidence SHA：
- Exact-head relationship：MATCH / MISMATCH / UNVERIFIED
- Required checks observed：
- Current main OID / relationship to reviewed candidate：MATCH / MISMATCH / UNVERIFIED

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
