# MCP controlled-write recovery（MCP 受控写入恢复）

Normal Apply 与 CLI generation 在获取共享 output lock 时会自动 recover 或 clean transaction state。不要仅为了让新的 write 继续而手动删除 lock、journal、staging directory、backup 或 ownership manifest。

## Files and phases

每个 configured output root 可能临时包含：

- `.openapi-to-write.lock/owner.json` — current writer PID and random nonce;
- `.openapi-to-transaction.json` — checksummed transaction phase and relative hash plan;
- `.openapi-to-transaction/<transaction-id>/stage/` — verified future bytes;
- `.openapi-to-transaction/<transaction-id>/backup/` — pre-Apply managed bytes and manifest.

Full write 使用 journal schema v1。Selective MCP Apply 使用 schema v2，因为 trusted controlled selection state 参与 transaction。每个允许的 state parent 可能临时包含 `.openapi-to-state-transaction/<transaction-id>/{stage,backup}/`。Journal v2 只存储 Workspace-relative identity 与 hash；recovery 需要原始 startup-trusted Workspace 和 `.openapi-to/selections` root。正常 successful Apply 或 automatic recovery 会移除这些 directory。

Staging 属于 pre-commit。Backup 与 committing 可能已经移动 managed file。Committed 表示新 file 与 manifest 已切换，但 cleanup 可能尚未完成。

## Automatic behavior（自动行为）

下一次 CLI write 或 MCP Apply 会先获取 lock，再执行 recovery：

1. Live lock owner 会触发有界等待，随后返回 `MCP_WRITE_LOCKED`。
2. Dead/stale owner record 可以安全移除；PID liveness 只能作为 lock-retention signal，绝不是 hash 的替代。
3. v1 staging journal 会清理；v2 staging 会 rollback，并移除新创建的空 state directory，不改变旧 formal state。
4. Backup/committing journal 会在验证每个 output、ownership 和 controlled-state backup/target hash 后按反向顺序 rollback。
5. 只有每个 output、ownership-manifest 和 journal-v2 state hash 都匹配 committed state 时，committed journal 才会清理。
6. 缺失、变化、symlink、过大、错误 root 或 invalid journal/backup 会以 `MCP_WRITE_RECOVERY_REQUIRED` 失败。

在 recovery 未被证明安全前，不会继续新的 Apply。

## recovery-required state 的 Operator procedure

1. 停止所有指向该 output root 的 MCP Server、Codex session、CLI generate、editor generator 和 CI job。
2. 在同一 trusted machine 保留 output root（包括 dotfile）的 byte-for-byte copy，以及 relative journal identity 指定的 trusted controlled-state transaction directory，以便调查。
3. 检查 stderr 中的 `generation_recovery_required`、`MCP_WRITE_RECOVERY_REQUIRED` 或 `MCP_WRITE_ROLLBACK_FAILED`。Log 会有意省略 file body、token、config 和 OpenAPI content。
4. 确认 output root 是 configured Workspace-local directory，且没有变成 symlink、mount replacement 或意外 hard link。
5. 将 journal 的 relative path 与 hash 视为 evidence，而不是执行 arbitrary command 的 instruction。不要为绕过 validation 编辑它。
6. 如果 automatic hash-proven rollback 无法完成，从 known-good backup 或 version control 恢复整个 output root；单独保留 unmanaged user file。
7. 只有独立验证 restoration 完成且没有 writer active 后，才移除 transaction internals。
8. Restart Server，运行 `openapi_check_generation`，然后创建并明确 review 新的 Prepare plan。Restart 后旧 token 无效。

如果无法证明 restoration byte-identical，不要报告 generation 为 current。将 output root 和保存的 transaction evidence 提交人工 review。
