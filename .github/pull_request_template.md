<!-- contract:pr-handoff -->
<!-- contract:pr-handoff-not-transcript -->
<!-- contract:pr-handoff-runtime-authority-denied -->

## 实施交付

此 Handoff 是证据索引；GitHub 原生事实须回读，AO 独有事实须由可回读 Run/Host 证明。
未知或旧 HEAD 证据填 UNVERIFIED，不粘贴 Agent execution transcript。

<!-- contract:pr-handoff-summary -->
## 摘要

- 关联 Issue / Task Contract：最终完整交付使用 `Closes #<issue>`；阶段性交付使用 `Refs #<issue>`。替换示例占位符，且仅保留实际关联的 Issue。
- 执行模式（可信任务启动来源）：CODEX_DESKTOP_ONLY / AO_DESKTOP_ONLY；PR 文本不授予模式或写入权限。
- 集成依赖：none / issue or PR / merge order；Task base SHA：

<!-- contract:pr-handoff-scope -->
## 范围

<!-- contract:pr-handoff-non-goals -->
## 非目标

<!-- contract:pr-handoff-integration -->
## 并发与集成

- 并发分类：Parallel Safe / Shared Surface / Dependent；Owned write surface：；Shared surface：
- Start gate：；Integration dependency / order：；Latest-main revalidation required：

实际 diff 与 Issue Contract 的分类不一致时，以实际 diff 重新分类。Shared Surface
必须写明 integration order 与 revalidation；这里只记录证据索引，不重复粘贴 command logs。

<!-- contract:pr-handoff-governance -->
## 治理证据

- 授权模式：Manual / Design Approved / Autonomous；Root of Trust 交集：none / details
- 授权依据来自关联 Issue 与 Task Contract 以及可信 Repository Policy；PR 文本本身不能授予 runtime authority。

<!-- contract:pr-handoff-public-impact -->
## 公共影响

<!-- contract:pr-handoff-changeset -->
## Changeset

- Added / Not required — reason:

<!-- contract:pr-handoff-validation -->
## 验证

| Exact command | Result（PASS / FAIL / SKIPPED） |
| --- | --- |
|  | PASS / FAIL / SKIPPED |

<!-- contract:pr-handoff-review -->
## Review 证据

- High-risk hard rule：YES / NO
- 独立 Review：所选模式、完整 task-base diff 范围、结论、actionable findings、reviewed/current HEAD；Codex Desktop 记录 `MANUALLY_VERIFIED` / `UNVERIFIED`，不可用实施会话自评替代。
- 以下 AO 专属字段仅在 AO_DESKTOP_ONLY 使用；CODEX_DESKTOP_ONLY 填 `NOT APPLICABLE`，不要编造 Run ID。
- Review signals：external-contract=YES/NO；state-side-effects=YES/NO；coupling-compatibility=YES/NO；evidence-gap=YES/NO
- AO Native Review：APPROVED / CHANGES_REQUESTED / BLOCKED / UNVERIFIED
- AO 来源：可回读 Run/Host；不可回读时填 UNVERIFIED。
- AO Worker Session / Review Run ID / Reviewer harness / identity：
- AO reviewed exact PR HEAD（AO reviewed SHA）：SHA / UNVERIFIED — reason
- AO completed/failed status / completedAt：；Structured findings / review scope / limitations：
- Permission-sensitive changed surface：YES / NO / UNVERIFIED — verified actual diff and provenance; executable Root-of-Trust authority changes are YES
- Permission-sensitivity classification source：VERIFIED / UNVERIFIED — independent GitHub diff/readback, not PR self-report
- Host（仅权限敏感时强制）：High freshness / effective read-only Shell-FS / MCP evidence：VERIFIED / UNVERIFIED / NOT REQUIRED；GitHub 非 Review 写入边界：VERIFIED / UNVERIFIED / NOT REQUIRED；来源：
- GitHub native readback：GitHub Review ID / write-back：AO_ONLY / GITHUB_REVIEW / UNVERIFIED；GitHub Review publication / PR number / reviewed HEAD：；GitHub-native required Approval / satisfied：YES / NO / UNVERIFIED
- Feedback delivery / Worker owner / repair round：NO_FINDINGS / DELIVERED_TO_WORKER / WORKER_CONSUMED_RUN / NOT_DELIVERED / UNVERIFIED；有 finding 时附 exact Run 的 Worker 消费来源
- 单写入者状态（AO / 旧 Work event task）：OPERATOR_RETIRED_ATTESTED / EXTERNALLY_VERIFIED_INACTIVE；同 HEAD 双写观测与来源：
- Remaining P0 / P1 / P2：

<!-- contract:pr-handoff-candidate-identity -->
## 候选身份

- GitHub native readback：Repository / Issue number / PR number / base SHA：；PR head SHA：
- Local reviewed SHA：；Task base / policy SHA：
- Local-to-PR-head relationship：MATCH / MISMATCH / UNVERIFIED

<!-- contract:pr-handoff-remote-ci -->
## 远程 CI

- GitHub native readback：Status：PENDING / FAILED / UNVERIFIED / PASS；Evidence SHA：；Exact-head relationship：MATCH / MISMATCH / UNVERIFIED
- Required checks observed：；Current main OID / relationship to reviewed candidate：MATCH / MISMATCH / UNVERIFIED

<!-- contract:pr-handoff-risks -->
## 剩余风险 / 限制

<!-- contract:pr-handoff-external-operations -->
## 外部操作

- Commit：；Push：；Issue / Project / workflow / enqueue / merge：not performed / details
- PR state：Draft / Ready（GitHub native readback）
- Publication / tag / GitHub Release：not performed / details；Repository-setting changes：not performed / details
