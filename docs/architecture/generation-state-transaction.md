# Generation state transaction（生成状态事务）

状态：Phase 2 B2b 的 selective Apply 使用 B2a transaction foundation。

## 为什么三种状态属于同一个 transaction

一次 selective generation commit 会持久化三个相互关联的事实：

```text
generated artifacts
+ ownership manifest
+ Generation Intent manifest
        -> one generation state transaction
```

只更新 generated files 会使 cleanup ownership 或后续 selection 出错；先更新 ownership 可能让旧文件看起来由新 plan 管理；只更新 selection 则会在 projected code 尚不存在时宣称它已存在。因此 Core 提供统一的 transaction implementation，将 generated artifacts、ownership manifest 和有界 controlled sidecar state files 一起 stage、backup、install、verify、rollback 和 recover。

B2a 通过 `commitGenerationStateTransaction()` 暴露此能力。现有 `commitOutputTransaction()` 是一个 compatibility wrapper，以无 state file 的方式调用同一实现。因此 full CLI generation 和 full MCP Apply 保持既有行为并继续使用 journal schema v1。

## Controlled state model（受控状态模型）

`TransactionStateFile` 包含有界 identifier、POSIX Workspace-relative path、完整的 `expectedBefore` physical snapshot、确定性的 desired bytes 与 SHA-256，以及单文件字节上限。`TransactionRecoveryContext` 提供 trusted absolute Workspace 和一个或多个 Workspace-relative controlled state root。这些对象是 trusted application code 的 Core API input；任何 MCP Tool argument 都不能提供 state path、state root、bytes、stage path、backup path 或 journal path。

Core 强制执行：

- at most 16 state files, 1 MiB per file, and 4 MiB of state bytes per transaction;
- a maximum 512-character normalized relative path and a bounded unique id;
- no absolute paths, `..`, backslashes, duplicate ids/paths, output-root overlap, or transaction-directory collision;
- a real Workspace, a narrower controlled root, and targets beneath that root;
- no symlink segment, hard-linked target, directory, device, or other non-regular target;
- a complete before hash/byte/filesystem identity for an existing file and exact revalidation before backup;
- desired bytes that exactly match the declared hash and limit.

B1 selection reader 现在同时拒绝 hard link 和 symlink。其 selective plan binding 包含 previous semantic hash、previous physical snapshot、desired semantic hash、desired serialized-byte SHA-256 和 desired byte length。Serialization 是确定性的；B2a 不添加 `updatedAt` 或任何 Apply-time value。

## Journal versions and storage

Journal schema v1 仍是 generated artifacts 加 ownership 的 no-state format。Schema v2 增加 Workspace-root hash、state operations 和 state-created directories。每个 state operation 只记录 id、Workspace-relative target/stage/backup identity、before/after snapshot 和 index。Journal 永不包含 absolute path、Workspace name、selection body、generated body、OpenAPI document、token、config、credential 或 header。

两个版本都在 output root 使用 `.openapi-to-transaction.json`，并对 stable JSON 计算确定性的 SHA-256 checksum。Output stage/backup bytes 保持在 `.openapi-to-transaction/<transaction-id>/` 下。每个 controlled state file 都在其 trusted target parent 下 stage 和 backup：

```text
.openapi-to/generation-intents/
  <target>-<identity>.json
  .openapi-to-state-transaction/<transaction-id>/
    stage/<index>
    backup/<index>
```

这样每次 state rename 都发生在其 target filesystem 内。接受 journal v2 前，recovery 会从 target identity 与 transaction id 重新推导这些 path，并再次与 startup-trusted recovery context 对照。

## Commit order

实现使用以下可恢复的 phase boundary：

1. Validate output preconditions and every controlled state before snapshot, hash, identity, path, and device.
2. Create the output transaction area and persist a checksummed `staging` journal before moving formal state.
3. Stage and fsync changed generated artifacts, the ownership manifest, and all desired state bytes; verify every staged hash.
4. Persist `backup`, then revalidate and move old generated files, ownership, and state files to their same-filesystem backups.
5. Persist `committing`.
6. Install generated artifacts, then ownership, then controlled state files. State is deliberately last so it never advertises the new selection before code and ownership are installed.
7. Verify all generated, ownership, and state after-snapshots.
8. Persist `committed`.
9. Remove known stage/backup storage and the journal.

在平台支持时，文件及其 parent directory 会执行 fsync。这是可恢复的 filesystem transaction emulation，不是 database ACID。

## Rollback and crash recovery

在 `committed` 之前，普通错误按反向顺序恢复 state targets、generated targets、ownership，最后恢复新建的空目录。现有文件只从 hash-matching backup 恢复；transaction addition 仅在匹配记录的 after-snapshot 时删除；managed deletion 会恢复。随后移除已知 transaction storage。若无法证明某次 move，保留 journal 并报告 recovery-required error，不宣称成功。

获取 output lock 会自动触发 recovery。Journal v1 遵循既有 full-output path。对于 v2：

- `staging` rolls back untouched formal state and removes stage/created directories;
- `backup` and `committing` restore all three old states;
- `committed` verifies all three desired states and only then completes cleanup;
- a committed mismatch, missing trusted recovery context, invalid relative path, unknown journal version, bad checksum, unsafe link, or missing/changed backup fails closed and preserves evidence.

State failpoint 为 `state-stage`、`state-after-stage`、`state-backup`、`state-after-backup`、`state-rename`、`state-after-rename`、`state-verify` 和 `state-cleanup`。它们用于普通注入失败及 subprocess crash recovery tests。

## Cross-device policy

首个实现要求 output root 与每个 controlled state target parent 报告相同的 filesystem device identity。若不一致，在 staging 前返回 `SELECTIVE_STATE_CROSS_DEVICE_UNSUPPORTED`。绝不回退到 copy-and-delete，因为这会破坏 atomic-rename 和 recovery 假设。Multi-output transaction 仍不在范围内。

## MCP selective Apply integration

Selective Prepare 仍无副作用，但现在会为完整 frozen plan 签发 one-time token。Selective Apply 将包含 prior physical Generation Intent snapshot 和 exact desired bytes 的 internally derived `TransactionStateFile` 传给 `commitGenerationStateTransaction()`。它提供 startup-trusted Workspace 与 `.openapi-to/generation-intents` recovery root；Tool argument 不能提供这些值。

Add 和 non-empty replace 都使用同一 transaction path。Replace 可以包含 safe managed deletions；rollback 或 pre-commit crash recovery 会连同 ownership 与 selection 一起恢复。Remove、clear、prune、historical full-output bootstrap、output migration，以及 caller-selected output 或 cleanup policy 仍 unsupported。Full plan 继续使用 journal v1 和 `commitOutputTransaction()`；只有带 controlled selection state 的 selective plan 使用 journal v2。
