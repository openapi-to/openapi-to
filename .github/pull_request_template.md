## Implementation handoff / 实施交付

此 Handoff 是简洁的证据索引。关联 Issue、actual diff、当前 PR head、
independent review 与已观察的 CI 仍是权威依据；不要粘贴会话日志（not an Agent execution transcript）。

## Summary（摘要）

- Issue / task:
- Integration dependency: none / issue or PR / merge order
- Task base SHA:

## Scope（范围）

## Non-goals（非目标）

## 并发与集成（Concurrency and integration）

- Parallelization: Parallel Safe / Shared Surface / Dependent
- Owned write surface:
- Shared surface:
- Start gate:
- Integration dependency / order:
- Latest-main revalidation required:

实际 diff 与 Issue Contract 的分类不一致时，以实际 diff 重新分类。Shared Surface
必须写明 integration order 与 revalidation；这里只记录证据索引，不重复粘贴命令日志。

## Governance evidence（治理证据）

- Authorization mode: Manual / Design Approved / Autonomous
- Root-of-Trust intersection: none / details
- Authorization evidence belongs to the linked Issue/task and trusted policy; this PR text does not grant runtime authority.

## Public impact（公共影响）

## Changeset

- [ ] Added
- [ ] Not required — reason:

## Validation（验证）

| Exact command | Result |
| --- | --- |
|  | PASS / FAIL / SKIPPED |

## Review evidence（Review 证据）

- Independent review: READY / NOT READY / not applicable
- Review rounds:
- Reviewed SHA:
- Remaining P0 / P1 / P2:

## Candidate identity（候选身份）

- Local reviewed SHA:
- PR head SHA:
- Local-to-PR-head relationship: MATCH / MISMATCH / UNVERIFIED

## Remote CI（远程 CI）

- Status: PENDING / FAILED / UNVERIFIED / PASS
- Evidence SHA:
- Exact-head relationship: MATCH / MISMATCH / UNVERIFIED
- Required checks observed:

## Remaining risks / limitations（剩余风险/限制）

## External operations（外部操作）

- Commit:
- Push:
- PR state: Draft / Ready
- Issue / Project / workflow / enqueue / merge: not performed / details
- Publication / tag / GitHub Release: not performed / details
- Repository-setting changes: not performed / details
