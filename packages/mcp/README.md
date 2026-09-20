# @openapi-to/mcp

`@openapi-to/mcp` 是有界 `openapi-to` stdio MCP adapter 的独立发布 internal/advanced package。Generation v2 有三个 startup capability mode：默认的 `developer` 将 `openapi_generate` 作为 Core 验证、Workspace-confined 的直接写入入口；`read-only` 只允许 preview；`hardened` 只允许 preview，并额外提供 two-phase、transaction-backed Prepare/Apply。

大多数用户应安装 `openapi-to`；它包含此 runtime，并提供相同的 `openapi-to-mcp` command：

```sh
pnpm add -D openapi-to
pnpm exec -- openapi-to-mcp --workspace-root .
```

如果确实需要 internal package boundary，advanced consumer 仍可直接安装 `@openapi-to/mcp`；其独立 bin 与 JavaScript server API 仍受支持。

package/source execution 与 Host-specific configuration 见 [getting started](../../docs/getting-started.md)。所有 Host 共用文档化的 [MCP security boundary](../../docs/mcp-security.md) 和 [troubleshooting guide](../../docs/troubleshooting.md)。

不带 `--config` 时，Server 暴露 `openapi_validate`、`openapi_inspect` 和 `openapi_diff`。提供 trusted Workspace-local project configuration 后，增加 `openapi_list_targets`、`openapi_search_operations`、`openapi_get_operation`、`openapi_generate` 和 `openapi_check_generation`。可用 `--generation-mode read-only|hardened` 选择更严格的 capability：

```sh
openapi-to-mcp --workspace-root . --config ./openapi.config.ts
```

Config 是 executable trusted project code，只能由 Server operator 选择，并缓存于 Server lifetime。Tool caller 不能替换它、改变 Workspace、选择 plugin 或放宽 remote-network policy。所有 local OpenAPI input 和 transitive local `$ref` 都限制在 real Workspace 内。Developer mode 省略 `mode` 时持久化写入；显式 `mode: 'dry-run'`、read-only mode 与 hardened mode 都只 preview。`strategy: 'add'` 和 `strategy: 'replace'` 持久化 Generation Intent；`strategy: 'ephemeral'` 只允许 dry-run。Dry-run/check 会执行 plugin，但从不写 generated file、ownership manifest、snapshot、plan 或 cache。

Catalog Tool 在每个 Server process 中对每个 trusted target compile 一次，构建 lightweight operation index，然后按 stable `operationKey` search 并读取一个 bounded contract。Search 默认最多返回八个 candidate。Contract Schema summary 默认 depth 2、20 个 Schema、每个 Schema 50 个 property、不含 example，Core budget 为 128 KiB，且受 MCP total-result budget 约束。修改 trusted config 或 OpenAPI 后需 restart Server。参见 [Operation Catalog architecture](../../docs/architecture/operation-catalog.md)。

Target listing 遵循 trusted configuration order。每个 Target 绑定一个 input、一个独立的 output/ownership root，以及自己的 catalog/Generation Intent/plan identity；不同 service 中相同的 `operationId` 或 Schema name 仍相互隔离。Output 可以使用默认 managed `.openapi-to/<dir>` base，或显式的 generator-managed Workspace base。Shared Core preflight 在 generation 前拒绝不安全或重叠的 root，Generation Intent state 则位于 `.openapi-to/generation-intents`。

`openapi_generate` 对恰好一个 trusted target 接受 full 或 operation selection。`output.root` 是 Workspace-relative caller input，由 Core 做 traversal、symlink、protected/overlap 与 persistent relocation validation；初次 persistent generation 可以绑定它，后续不能通过 caller 参数搬迁既有 intent。Response 只包含 bounded selection、projection 和 artifact summary，不包含 projected OpenAPI document。参见 [projected compilation architecture](../../docs/architecture/projected-compilation.md)。

## Hardened generation writes（强化生成写入）

只有 operator 同时提供 trusted config 与 `--generation-mode hardened` 时，才会启用 Prepare/Apply：

```sh
openapi-to-mcp \
  --workspace-root . \
  --config ./openapi.config.ts \
  --generation-mode hardened
```

这会注册 `openapi_prepare_generation` 与 `openapi_apply_generation`，共十个 Tool。Prepare 执行 generation，并存储 short-lived complete plan，绑定 config、source 与 local `$ref` file、remote response hash、Workspace/output identity、ownership manifest、planned file、artifact hash、generator version 和一个 target。它不创建 output directory，也不写 file。Apply 只接受 `planId`、`token` 和 `approvedPlanHash`；它重新 generation、revalidate 每个 bound precondition、拒绝 drift，然后通过与 developer direct path 相同的 shared Core lock/journal/rollback writer commit。MCP 不维护第二套 writer 或 path validation。

Prepare 还接受 persistent selection mutation。`selection: { type: 'add', operationKeys: [...] }` 计算 `desired = previous ∪ requested`；`selection: { type: 'replace', operationKeys: [...] }` 计算 `desired = requested`，因此可能报告 managed deletion。Add 保留 500-key request batch limit；Replace 接受完整的 5,000-key Generation Intent capacity，使任意合法 desired selection 都能在一个 request 中表达。每个 key 最多 500 UTF-8 bytes，serialized desired intent 仍限制为 1 MiB。Replace 至少需要一个 exact key；空 replace 不是 `clear`。Prepare 读取 Core 派生的 `.openapi-to/generation-intents/<target>-<identity>.json`，对含糊的 bootstrap/history drift fail closed，并生成完整 desired projection。Mutation type、previous/requested/added/already-selected/retained/removed/desired key、intent hash 与 exact desired byte、projection、artifact、ownership byte、target 和 output identity 都进入 plan/token binding。成功的 selective Prepare 返回 `applySupported: true` 和 one-time token，但不写 Generation Intent、generated file、ownership、lock、journal 或其他 disk state。

经过明确 review 和 approval 后，Apply 会重新编译 trusted target，精确重新生成 frozen complete desired key set，并对 selection 做两次 revalidate（其中一次在 output lock 内），比较 projection/artifact/ownership/desired-selection identity，然后调用 Core 的 three-state transaction 处理 generated artifact、ownership 和 selection。Replace 在内部启用受 ownership 约束的 managed cleanup，即使 trusted target 通常保留旧 generated file，也只安全删除 desired set 中不存在且未变化的 managed artifact；unmanaged file 会保留。该 policy 由 Server 派生，caller 不能提供。Remove、clear、prune、historical full-output migration 和 operation-rename migration 仍 unsupported。Full Prepare/Apply 不变，caller 不能提供 output path 或 cleanup policy。参见 [persistent operation selection](../../docs/architecture/persistent-operation-selection.md) 和 [generation state transaction](../../docs/architecture/generation-state-transaction.md)。

Plan 默认存活五分钟，最多保留 20 个 in-memory plan。Token 使用 per-process HMAC key，绑定 full 与 selective kind、trusted target/output/selection owner，只能使用一次，并在 Server restart 后失效。Lock/token consumption 前的 verification failure 只有在 returned diagnostic 指示 plan stale 时才需要新的 Prepare；等待 lock 时 cancellation 会保留 token 的 retryability。一旦 token 被消费，regeneration mismatch、transaction failure、rollback 或 success 都会使 replay 失败。本版本有意将一个 plan 限制为恰好一个 configured target/output root。不存在 `force`、stale-plan override、dynamic config、caller-supplied path/content 或 direct write tool。

Server 可以证明 Apply 指向 Prepare 返回的 exact plan，但不能独立证明 confirmation 由 human 执行；final approval 取决于 MCP Host。Operator 应要求 Host 对 `openapi_apply_generation` 做 approval，尤其是 Prepare 报告 managed deletion 时。

Remote access 默认拒绝 private network。使用可重复的 `--allow-host` option 收窄 allowed host。`--allow-private-network` 仅 operator 可用，并会降低 security boundary。Target `input.remote` 仍是 trusted access requirement，并与 operator policy 求 intersection：两层都必须允许 private access，host policy 必须重叠，numeric limit 取较小值。Target-configured header 只在 initial request 和 same-Origin redirect 中保留；cross-Origin redirect 会清除全部 header，HTTPS-to-HTTP redirect 会被阻止。Tool argument 不能提供 header 或放宽 result。

Package 有意不提供 HTTP transport、authentication、resources、prompts、sampling、elicitation、Tasks、Apps UI、LLM call、background job、arbitrary write、OpenAPI/config modification 或 business API execution。

## Production controls（生产控制）

每个 request 同时受 Host-side 与 Server-side limit 约束。Server 默认 validate/inspect 为 30 秒、diff 为 45 秒、generation Tool 为 60 秒；operator 可将 `--validate-timeout-ms`、`--inspect-timeout-ms`、`--diff-timeout-ms` 和 `--generation-timeout-ms` 设置为 100 至 600000 milliseconds。Tool argument 不能延长这些 limit。它们与 remote HTTP connection/response limit、transaction commit deadline 和 Codex `tool_timeout_sec` 分离。

Controlled-write startup limit 包括 `--plan-ttl-ms`、`--max-plans`、`--max-plan-bytes`、`--max-total-plan-bytes`、`--max-write-files`、`--max-write-bytes`、`--write-lock-wait-ms` 和 `--commit-timeout-ms`。Plan metadata 默认每个 plan 16 MiB、总计 64 MiB；这在容纳合法 selection 的完整 derived set 与 frozen byte 的同时保持 aggregate memory 有界。Tool argument 不能放宽这些 startup-owned limit。Apply 可以在等待、regenerating 或 staging 时取消；commit 开始后，cancellation 会延迟到 transaction 完成或 rollback，独立的 commit deadline 仍有效。

MCP cancellation 会传播到 remote fetch、reference loading、compiler checkpoint、通过 `ctx.signal` 传递给 plugin hook、artifact materialization/formatting/comparison 以及 per-server generation queue。被取消或超时的 generation 永不调用 writer；queued cancellation 不会遗留 lock。Stable client 可以为 diff/dry-run/check 请求 coarse progress。Progress 仅供参考、单调递增且不含 content，并在 cancellation 时停止。

Operational log 保持在 stderr。`--log-format text|json` 选择 text 或 newline-delimited JSON，`--log-level debug|info|warn|error|silent` 控制 verbosity。Log 只包含有界 count 和 duration，绝不包含 Tool argument、document、generated content、credential、query string、header、environment variable 或 config source。

## Repository verification（Repository 验证）

开发此 monorepo 时，从 repository root 运行维护的 MCP entry point：

```sh
pnpm test:mcp:all
pnpm mcp:check
pnpm --silent mcp:check -- --json
pnpm mcp:inspect
pnpm mcp:inspect -- --generation-mode hardened
```

Package manifest 拥有 unit、integration、stdio、controlled-write、recovery、E2E 和 performance layer；root script 只负责路由。Doctor 使用 synthetic OS-temporary Workspace，并以 official SDK 运行 built bin，覆盖 3/8/8/10 capability matrix。Inspector 是 repository-only authenticated localhost launcher，支持 developer、read-only、hardened 三种 Generation v2 session。
从 stdout 消费 Doctor JSON 时使用 pnpm 的 `--silent` flag，避免 package manager 添加 lifecycle banner。`--json --output <path>` 会直接将同一份 sanitized report 写入 CI 使用的 file。两个 repository helper 都不包含在 published tarball 中。

参见 [controlled-write architecture](../../docs/architecture/mcp-controlled-write.md)、[operations](../../docs/mcp-operations.md)、[test strategy](../../docs/testing/mcp-testing.md)、[Inspector guide](../../docs/testing/mcp-inspector.md)、[recovery](../../docs/mcp-write-recovery.md)、[threat model](../../docs/mcp-threat-model.md) 和 [limitations](../../docs/mcp-limitations.md)。
