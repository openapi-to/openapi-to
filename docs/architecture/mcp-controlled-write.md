# Controlled MCP generation write architecture（受控 MCP 生成写入架构）

状态：P3 已接受（2026-07-18）。

## Decision and authority（决策与权限）

`@openapi-to/mcp` 保留八个 configured-mode read-only tool，并增加且仅增加两个 operator-gated tool：

```text
openapi_prepare_generation -> review -> openapi_apply_generation
```

只有启动时同时提供 Workspace-local trusted config 和 `--allow-write`，且每个 configured output root 都通过 Workspace boundary 后，这两个 tool 才会注册。Tool argument 既不能授予 write authority，也不能选择 config、plugins、output roots、content、delete policy、environment、shell、`force` 或绕过 validation。没有 `--allow-write` 时，configured Server 恰好暴露八个 read-only tool。

本版本将每个 plan 限制为一个 configured target 和一个 output root。这样 transaction boundary 可解释，也不会声称具备 cross-filesystem atomicity。Multi-target Prepare 以 `MCP_WRITE_SINGLE_TARGET_REQUIRED` 失败，绝不会只应用第一个 target。

## Prepare and plan binding（Prepare 与 plan 绑定）

Prepare 在 dry-run mode 执行正常的 Core compiler/plugin/artifact/comparison pipeline，但什么都不写，包括 output directory、staging file、lock、journal、snapshot 或 ownership manifest。它的内部 deterministic payload 绑定：

- generator/package version and a semantic fingerprint of the loaded plugin/config object;
- Workspace real-path hash and filesystem identity;
- trusted config path plus every bundled local config source hash and identity;
- selected target and remote-policy hash;
- entry OpenAPI, every loaded local `$ref`, and remote response content hashes;
- output-root existence/identity, ownership manifest snapshot, and every planned managed-file snapshot;
- the complete sorted GenerationManifest and all materialized artifact path/kind/hash/byte tuples.

Artifact body 不会复制到 plan storage。Apply 必须重新执行 generation，并复现完全相同的 deterministic payload 与 artifact hash。这样既限制 plan memory，也能发现 non-deterministic 或已变化的 plugin output。

外部 response 只有有界 review summary。其 change list 可以被截断，但 internal plan 永不截断。Preview 默认关闭、仅文本且有界；绝不返回 binary content。

同一 Prepare/Apply pair 的第二种 plan kind 支持 additive 与 exact-replace selection mutation。Add 将 previous 与 requested operation key 求 union；non-empty replace 将 requested key 作为 complete desired set，并可能暴露 managed deletion。两者都加载固定的 trusted selection owner，复用 cached target compilation 进行 review，并生成完整 desired projected artifact set。Plan 绑定 mutation type、完整的 previous/requested/added/already-selected/retained/removed/desired set、previous selection 的 physical/semantic identity、exact desired bytes、projection、artifacts、deletion 和 desired ownership bytes。Prepare 返回 `applySupported: true` 以及绑定 kind/target/output/selection-owner 的 one-time token，但仍不写入任何内容。Apply 不使用 process catalog cache 重新编译 trusted target，在不接受 caller-supplied key 的情况下重新生成 frozen complete desired key set，并调用 Core 的 [generation state transaction](./generation-state-transaction.md)。Full plan/token/Apply protocol 保持兼容。

## Token and in-memory store（Token 与内存存储）

每个 Server instance 创建随机的 256-bit secret 和 process nonce。Token 是对 plan ID、plan kind、complete deterministic plan hash、authorization-context hash、trusted target、Workspace hash、expiry 和 Server nonce 计算 HMAC-SHA256 后的 canonical Base64URL encoding。Authorization context 绑定 trusted output identity；对 selective plan 还绑定 internally derived selection owner。Verification 以 constant time 比较 exact、Schema-bounded canonical encoding，因此同一个 MAC 的 alternate encoding 会被拒绝。`planId` 只是 lookup key，不具有 authorization value。

Plan 只存在于 per-Server memory store。默认 TTL 为五分钟，最多 20 个 plan，每个 plan 的 metadata 上限为 16 MiB，总 metadata 上限为 64 MiB。单 plan 预算可容纳任意合法 1 MiB selection 的完整 derived set 与 frozen bytes；总预算仍限制 aggregate process memory，并确定性地淘汰 least-recently-used plan。Store 还提供 periodic unref'ed cleanup、once-only consumption，并在 Server close 时清零 secret。Restart、expiry、eviction、另一个 Server、另一个 Workspace、changed plan hash 或 modified token 都会使 Apply 失效。Token 和 secret 永不进入 logs、generated files、manifest 或 disk journal。

Server 可以证明 Apply 使用的是 Prepare 返回的相同 plan hash，但无法证明确认动作确实由人执行。Security boundary 是分层的：startup operator grant、separate Prepare、exact one-time token/hash、immutable Apply schema、Tool description，以及 MCP Host 的 approval UI/policy。

## Apply validation and regeneration（Apply 验证与重新生成）

Apply 只接受 `planId`、`token` 和 `approvedPlanHash`。它先验证 plan，等待 per-Server generation queue 与 output filesystem lock，再消费 token。Full plan 遵循既有 regeneration path。Selective plan 在获取 lock 前对 selection 做 physical 与 semantic revalidation，重新编译 trusted target，精确 projection frozen desired key（绝不与 current disk 做 union），比较 projection statistics/hash 及完整有序 artifact 与 ownership bytes，并在 commit 前、lock 内再次验证 selection。Local source/config snapshot 也会在 commit 前立即重读。

Config、source、`$ref`、selection、output-root、ownership manifest、managed-file、projection、artifact order/body、generator 或 plugin drift 都会安全地使 plan stale，并要求新的 Prepare。新增 target path 必须仍不存在；modified/deleted path 必须具有 prepared hash；deleted file 必须仍是 current ownership manifest 中 regular 且未变化的 entry。Output lock 之前检测到 selection drift 不会消费 token；消费之后的 regeneration/transaction failure 不能用该 plan 重试。不存在 automatic re-planning 或 force path。

## Shared transaction writer（共享 transaction writer）

Core 拥有 CLI generate 与 MCP Apply 共用的 writer。Output-root lock 是 atomically created directory，内含 PID 和 random owner nonce。它验证 lock/root filesystem identity，不把 owner record 当作 file-integrity proof；hash 始终在 lock 内重查。Live owner 永不被替换；dead owner 可以清理，随后必须先 recovery journal，新 writer 才能继续。Rename/locking 语义较弱的 network filesystem 仍是已记录的 limitation。

Transaction 在 output root filesystem 内 stage 每个 added/modified artifact 和 version-2 ownership manifest，fsync 并验证 staged hash，写入带 checksum 的 relative-path journal，backup changed managed files 与 prior manifest，rename staged file 到位，切换 manifest，再清理 backup。只有 exact manifest change set 中的 path 参与；它从不递归清理或扫描 arbitrary user files。

Commit 开始后的任何 ordinary failure 都触发 reverse-order rollback。成功返回表示所有 planned files 与 ownership manifest 均匹配；rollback-success error 表示 pre-Apply byte state 已恢复；`MCP_WRITE_ROLLBACK_FAILED` 表示无法证明恢复成功，operator 必须停止 writer 并遵循 recovery guidance。这是 filesystem transaction emulation，不是 database ACID。

Version-2 ownership manifest 是 stable 的，只包含 generator name/version 以及 sorted managed path/hash/bytes/kind record；不包含 machine path、config、plan ID、token 或 input body。Version-1 manifest 仍可读，并且只在 successful write 时升级。

## Crash recovery and cancellation（崩溃恢复与取消）

Journal 是 `.openapi-to-transaction.json`；staged/backed-up bytes 位于 `.openapi-to-transaction/<transaction-id>`。它只记录 schema、transaction/output identity、phase、relative operations、before/after hash 和 created directories。Checksum 可检测 accidental 或 unsophisticated modification；由于跨 restart 没有 MAC，同一用户对 journal 的篡改不被视为 cryptographically preventable。Recovery 在移动任何内容前仍验证 schema、confinement、symlink、target/backup hash 和 output-root identity。

No-state full write 继续生成 journal schema v1。Selective Apply 对 trusted controlled state file 使用 Core journal schema v2，仅增加 Workspace-root identity 和 bounded relative state operations。State stage/backup storage 仍位于 controlled target 旁边；device mismatch 会在 Prepare preflight 或 transaction validation 时 fail closed。这不改变 full Apply public protocol，也不增加 Tool。

获取 lock 时，staging-only journal 会清理，backup/committing journal 会 rollback，committed journal 会先 verify 后清理。不安全或无法验证的 state 返回 `MCP_WRITE_RECOVERY_REQUIRED`，绝不忽略。

Prepare 与 Apply 在 commit 前支持 cooperative cancellation。Backup/commit 开始后，cancellation 会被记录但延迟到 successful commit 或 complete rollback，因为在 rename 之间 throw 会产生 half-applied state。独立的 bounded commit deadline 仍继续运行并触发 rollback。Generation 与 filesystem lock 在 `finally` 释放；等待期间 cancellation 不消费 plan。

## Residual limitations（剩余限制）

Node.js 无法为任意文件提供 database transaction。同一用户的 TOCTOU race 无法完全消除；突然断电取决于 filesystem durability semantics；恶意 trusted plugin 仍拥有正常 Node.js authority；network filesystem 可能不遵守 local atomic-rename expectation。Identity/hash revalidation、same-filesystem staging、fsync、lock/journal recovery 和 fail-closed behavior 可以降低风险，但不声称彻底消除风险。

Streamable HTTP、OAuth、multi-tenancy、Tasks、background generation、OpenAPI/config modification、dynamic plugins、arbitrary file writes，以及 direct write-without-Prepare 仍不在范围内。
