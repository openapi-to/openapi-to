# MCP test strategy（MCP 测试策略）

MCP package 拥有 repository-owned test surface。Maintainer 应使用下面的 root command，直接验证 MCP 变化，而不是依赖 full-repository Vitest 或 release smoke 间接发现 regression。

| Command | 用途 | 预期范围 |
| --- | --- | --- |
| `pnpm test:mcp:unit` | 纯逻辑与 filesystem-bounded contract | schema/options、result、diagnostic、limit、token、plan storage、path、config cache 和 logging |
| `pnpm test:mcp:integration` | Server/application integration | registration、structured result、error、concurrency、cancellation、timeout 和 generation serialization |
| `pnpm test:mcp:smoke` | 最小跨平台 stdio smoke | initialize、list、validate/config matrix、stdout/stderr 和 clean close |
| `pnpm test:mcp:stdio` | 真实 built-bin protocol E2E | official SDK `Client` 与 `StdioClientTransport`、3/8/10 Tool matrix、schema、annotation、call、lifecycle、stdout 和 stderr |
| `pnpm test:mcp:write` | Controlled-write E2E | Prepare read-only behavior、Apply、stale/tampered/replayed plan、managed deletion、unmanaged preservation 和 current state |
| `pnpm test:mcp:recovery` | 破坏性失败安全性 | rollback failpoint、cancellation phase、SIGKILL recovery、journal 以及 CLI/MCP 或 multi-Server locking |
| `pnpm test:mcp:e2e` | MCP process 与 transaction E2E | stdio、controlled write 和 Core transaction recovery evidence |
| `pnpm test:mcp:performance` | 有界性能 gate | multi-run benchmark regression 与 bounded repetition/concurrency stress |
| `pnpm test:mcp:all` | 完整的受维护 MCP gate | 所有 unique unit/integration/E2E/recovery test 及 bounded performance gate |

`pnpm test:mcp` 仍是 package-only compatibility entry，现在运行 137-test MCP inventory。Package manifest 是权威来源；root script 只负责路由。Test-group runner 使用 repository-relative explicit file，检查每个 file 都存在，并且不使用 `--passWithNoTests`，因此 stale group 不能在零 test 时静默通过。各 group 单独运行时有意共享部分 evidence；`all` entry 运行 unique union，而不是重复计算相同 file。

## B2b 之后的 inventory

| Test file | Tests | Primary evidence | Real stdio / official SDK | Temporary Workspace | Controlled write | Recovery or cancellation | Observed package-run time |
| --- | ---: | --- | --- | --- | --- | --- | ---: |
| `packages/mcp/src/options.test.ts` | 18 | Unit | no | no | option authority | timeout bounds | 4 ms |
| `packages/mcp/src/consumer-skill-contract.test.ts` | 5 | Unit/contract | no | no | Skill contract alignment | no | under 10 ms |
| `packages/mcp/src/logger.test.ts` | 2 | Unit | no | no | audit redaction | no | 10 ms |
| `packages/mcp/src/generation/generation-lock.test.ts` | 3 | Unit | no | no | queue isolation | cancelled waiter | 13 ms |
| `packages/mcp/src/generation/plan-store.test.ts` | 3 | Unit | no | no | HMAC, TTL, replay, LRU | cross-Server token rejection | 31 ms |
| `packages/mcp/src/generation/trusted-config.test.ts` | 2 | Unit | no | yes | config availability/cache | no | 108 ms |
| `packages/mcp/src/result.test.ts` | 2 | Unit | no | no | bounded result protocol | no | 3 ms |
| `packages/mcp/src/security/workspace.test.ts` | 3 | Unit/security | no | yes | output confinement | symlink escape | 14 ms |
| `packages/mcp/src/tools/limits.test.ts` | 4 | Unit/service | no | no | artifact/preview bounds | cancellation/listener cleanup | 58 ms |
| `packages/mcp/src/tools/schema.test.ts` | 12 | Unit/schema | no | no | all ten bounded input/output schemas, additive selection only | authority-field rejection | under 10 ms |
| `packages/mcp/src/catalog/trusted-target-registry.test.ts` | 3 | Unit/cache | no | yes | trusted target compilation/catalog cache plus fresh Apply compilation | concurrent first load, retry, target isolation | platform-dependent |
| `packages/mcp/src/generation/selection-state.test.ts` | 26 | Unit/service | no | yes | manifest, bootstrap, plan/token binding, direct selective Apply | symlink/hard-link/size/drift, three-state rollback, retry | platform-dependent |
| `packages/mcp/src/server.integration.test.ts` | 6 | stdio integration | yes | yes | read-only generation and catalog | queue/cache failure recovery | platform-dependent |
| `packages/mcp/src/lifecycle.integration.test.ts` | 3 | stdio lifecycle | child process (no SDK calls) | no | no | EOF, SIGINT, SIGTERM | 1.4 s |
| `packages/mcp/src/hardening.integration.test.ts` | 6 | stdio hardening | yes | yes | dry-run/check | active/queued cancel, timeout, disconnect | 7.2 s |
| `packages/mcp/src/controlled-write.integration.test.ts` | 39 | controlled-write stdio | yes | yes | full plus controlled Selective Prepare/Apply, no-op/replay, incremental selection | selection/source/ref/output/ownership/artifact drift, expiry, cancellation and locks | platform-dependent |
| `packages/core/src/artifacts/transaction.test.ts` | 20 | writer recovery | subprocess for SIGKILL case | yes | shared transaction writer | failpoints, rollback, crash, journal, lock | platform-dependent |
| `packages/core/src/artifacts/generation-state-transaction.test.ts` | 34 | state writer recovery | subprocess for SIGKILL cases | yes | artifacts + ownership + controlled state | journal v2, output/ownership/state failpoints, rollback, committed cleanup, first-create and crash recovery | platform-dependent; cross-device case conditional |

B2b 之前，15 个 MCP file 共包含 103 个 test。当前 package inventory 包含 137 个 MCP test；`all` entry 还包含 54 个 Core transaction test，总计 191 个 test（其中 1 个 test 可按平台条件 skipped）。Root Vitest config 已经发现原有 test，Quality workflow 也已间接运行它们。但在 P3.5 之前，E2E workflow 没有命名的 MCP job，package 只使用一个宽松的 `--passWithNoTests` command。Release smoke 会另外 pack/install MCP package，并验证 stdio 与 Prepare/Apply/replay/current；它是有用的 release evidence，但不是可发现的 development test taxonomy。

## 运行哪些测试（What to run）

普通 MCP change 应先运行受影响的 layer，再运行 `pnpm test:mcp:all`。Tool schema 或 registration change 必须运行 `stdio` 和 `pnpm mcp:check`。Prepare/Apply、lock、writer、cancellation 或 recovery change 必须运行 `write` 和 `recovery`。当 user-visible Tool metadata、approval semantics、progress、summary 或 interactive flow 变化时，运行 `pnpm mcp:inspect`。

Release 前还应运行 package typecheck/build、root Vitest/typecheck/build matrix、changed-file lint、package-surface verification、pack-install smoke 和 Changesets status。`pnpm release:smoke` 是 packed-consumer proof，不能替代 source-tree E2E 与 recovery gate。

## CI responsibilities（CI 职责）

Quality 保留 full-repository Vitest suite。E2E workflow 增加命名的 Node 22 job，使 MCP 状态在 CI 页面可见：

- **MCP stdio E2E** 运行 built binary、controlled-write E2E 和 Doctor；
- **MCP cross-platform smoke** 在 Linux、Windows 和 macOS 上运行；
- **MCP transaction safety** 在 Linux 上验证 rollback、cancellation、crash recovery 和 lock behavior，包括 journal v2 state recovery 及 cross-device fail-closed case；
- **MCP performance and bounded stress** 在 `main`、weekly schedule 和 manual dispatch 上运行，不在每个 pull request 上运行。

Doctor JSON 是唯一上传的 MCP report。它经过 sanitized，且不包含 plan token、generated body、fixture path 或 Inspector credential。

需要 machine-readable stdout stream 时，使用 `pnpm --silent mcp:check -- --json`；`--silent` 会抑制 pnpm 自己的 lifecycle banner，同时 Doctor 将 dependency-build log 路由到 stderr。CI 使用 `--json --output <path>`，无论 console presentation 如何，都写出一个稳定的 JSON document。

## Inspector 与 automated safety 的边界

Inspector 是 manual interaction surface。它验证 Tool discovery、schema、annotation、可读的 structured result、普通 Prepare/Apply/replay/tamper/stale behavior、managed deletion、unmanaged preservation、progress 和 common error。不得向它提供 failpoint、crash、cancellation 或 force Tool。

Internal failpoint rollback、byte-identical restoration、pre-commit 与 commit-critical cancellation、SIGKILL recovery、journal recovery 以及 lock competition 属于 automated Safety Gate。这些 case 需要精确 synchronization 或 process control，而 Inspector 0.22.0 无法可靠暴露这些能力。通过的 SDK/Core test 是补充 evidence，不得伪造为 Inspector UI result。

## 诊断 stdio pollution

Server 的 stdout 只能承载 JSON-RPC。若 protocol parsing 损坏，official SDK subprocess test 和 Doctor 会失败。Plugin `console` output 与 operational log 必须只出现在 stderr。调试时应单独捕获 stderr；不要把它合并到 stdout，也不要从 log 推断 Tool result。
