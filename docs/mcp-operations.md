# MCP operations guide（MCP 操作指南）

MCP Server 要求 Node.js 22 或更新版本，并且只使用 stdio。使用 `pnpm add -D openapi-to` 安装 aggregate，再启动 `pnpm exec -- openapi-to-mcp --workspace-root .`。不带 config 时注册 validate、inspect 和 first-stage diff；加入 operator-trusted `--config openapi.config.ts` 后，还注册 target listing、operation search、bounded operation contract reading、统一 `openapi_generate` 和 check。默认 developer mode；`--generation-mode read-only` 保持 8 个 Tool，`--generation-mode hardened` 在全部 configured output root 通过 Core validation 后增加 Prepare 与 Apply。完整 matrix 是：无 config 为 3 个 Tool，developer/read-only 各为 8 个，hardened 为 10 个。

Workspace 只 canonicalize 一次。Local entry、transitive `$ref`、config import、output root、ownership manifest 和 checked generated file 都必须位于其中。Explicit HTTP(S) root 是 caller/config 授权目标，包括内部网络。Same-origin `$ref` / redirect 自动允许；cross-origin derived requests 需额外 allowedHosts，operator 用 `--allow-host` 配置 hostname grants。Target/startup 两层非空 grants 求 intersection（空交集不影响 explicit root），numeric limit 取较小值，只有 trusted Target 可定义 request headers。Cross-origin `$ref` / redirect 清除 headers，HTTPS-to-HTTP redirect 失败；不提供 DNS/IP/private-address 隔离。

Server deadline 通过 `--validate-timeout-ms`、`--inspect-timeout-ms`、`--diff-timeout-ms` 和 `--generation-timeout-ms` 以 milliseconds 配置，值必须是 100 到 600000 的整数。Client cancellation 与 Server timeout 不同（`MCP_REQUEST_CANCELLED` 对比 `MCP_TOOL_TIMEOUT`）；remote HTTP timeout 是第三个 limit。Cancellation 会传播到 compiler、plugin、artifact、comparison 和 queue wait。

Result 是确定性的，并受 diagnostics、operations/changes、artifacts、text 和 preview limit 约束。Array 被截断时 totals 仍准确。Dry-run/Prepare 默认不提供 preview；绝不返回 binary body。Check 将 `outdated` 作为预期 business result 并返回 `isError: true`，不是 protocol failure。Dry-run/check 从不调用 writer。

完成 operation search 与 contract review 后，`openapi_generate` 可以接受一个 trusted target 以及 full 或 operation selection。Exact key 会去重并排序；`add`/`replace` 持久化 Generation Intent，`ephemeral` 只在 `mode: 'dry-run'` 下运行。Developer 省略 mode 时写入；read-only/hardened 永远 preview。Response 只暴露有界 projection statistic、确定性的 projection hash、artifact summary 和可选的有界 preview。`output.root` 是 Workspace-relative candidate，由 Core 验证并绑定初次 persistent intent，后续 relocation fail closed。参见 [projected compilation](./architecture/projected-compilation.md)。

对于持久化 intent，developer `openapi_generate` 与 Hardened `openapi_prepare_generation` 共用 selection mutation。`{ type: 'add', operationKeys: [...] }` 计算 `desired = previous ∪ requested`；`{ type: 'replace', operationKeys: [...] }` 计算 `desired = requested`，并可移除之前 selected 的 operation。Add 保留 500-key request batch limit；Replace 一次 request 最多接受完整的 5,000-key persisted-selection capacity，每个 key 最多 500 UTF-8 bytes，serialized desired manifest 最多 1 MiB。Replace 必须包含至少一个 exact key，空 replace 不是隐式 clear。Projection 与 generation 针对 complete desired set，而不只是 newly added key。Versioned manifest path 由 trusted config/target/output identity 派生，caller 不能提供。Bootstrap 或 OpenAPI identity drift 会 fail closed；不能用 ownership 推断缺失的 selection，也不会自动迁移 renamed operation。

Mutation type、完整的 previous/requested/added/already-selected/retained/removed/desired set、selection snapshot/hash/byte、projection、完整有序 artifact、desired ownership bytes，以及既有 source/config/output binding 都会进入 plan。External selection array 每个 category 最多返回 50 个 key，并提供 exact count 与 explicit truncation；internal plan 保留全部 key。Prepare 返回 `kind=selective`、`applySupported=true`、one-time token、有界 summary，且不改变 filesystem；replace 收缩会将 managed deletion 暴露给 approval。明确 approval 后，Apply 重新编译 trusted target，精确生成 frozen desired set，不接受 caller 提供的 operation key，重新验证每个 binding，并以原子方式提交 generated output、ownership 和 selection。Remove、clear、prune、historical full-output migration、rename migration、caller-selected path 和 caller-selected cleanup policy 仍 unsupported。Full Prepare/Apply 不变。参见 [persistent operation selection](./architecture/persistent-operation-selection.md)。

对于大型 specification，需要发现 target 时调用 `openapi_list_targets`，然后调用 `openapi_search_operations`，最后调用 `openapi_get_operation`。这些 Tool 只接受 startup-trusted target name，不接受 caller-supplied source/config/path。成功的 target compilation 和 catalog 存活于 Server process；并发首次调用共享一次 compilation，失败 compilation 可以重试，restart 是刷新机制。Search 默认八个 candidate，contract reading 应用 Schema depth/count/property/example 和 byte limit。参见 [Operation Catalog architecture](./architecture/operation-catalog.md)。

对于 multi-service project，推荐顺序是 `openapi_list_targets` → target-scoped search → target-scoped contract lookup → dry-run 或 Prepare → review → Apply。Target identity 独立于 OpenAPI `info.title`；不同 Target 中相同的 `operationId` 或 Schema name 不共享 catalog、cache、selection、plan 或 ownership identity。Operation-scoped dry-run 与 selective Prepare/Apply 仍恰好接受一个 Target。没有 cross-Target search 或 selective write plan。

## Controlled-write runbook（受控写入操作手册）

Hardened runbook 从 `--workspace-root`、trusted `--config` 和 `--generation-mode hardened` 开始。可选的 startup-only control 包括：

```text
--plan-ttl-ms 300000
--max-plans 20
--max-plan-bytes 16777216
--max-total-plan-bytes 67108864
--max-write-files 5000
--max-write-bytes 268435456
--write-lock-wait-ms 30000
--commit-timeout-ms 60000
```

对恰好一个 configured target 调用 Prepare。Review added/modified/deleted count、每个返回的 path、truncation 和 exact `planHash`；external list 被截断不代表 stored plan 被截断。Prepare 必须让 output tree 保持 byte-identical。只有得到 explicit user approval 后，Host 才应把返回的 `planId`、token 和 approved hash 传给 Apply。

Apply 会重新生成；遇到 stale 时失败，而不是采用新 content。Selective Apply 使用 plan 中 frozen 的 complete desired operation set，而不是从 disk 新建 union，并在 output lock 前和 lock 内各验证一次 selection。它只能删除 current ownership manifest 与 prepared deletion set 中列出的、未变化的 regular file。User/unmanaged file 会保留。成功会消费 token 并更新 file 与 version-2 ownership manifest；selective success 还会在同一个 journal-v2 transaction 中安装 selection。Commit 开始后的 failure 会 rollback 所有参与 state，或报告 recovery-required high-severity diagnostic。不存在 force 或 retry-with-new-plan behavior。

在 queued、regenerating 或 staging 阶段发生 cancellation 时会干净停止。Commit 开始后的 cancellation 会延迟到 commit/rollback 完成。Commit deadline 与 MCP generation timeout 分离。成功后，`openapi_check_generation` 应报告 current。

CLI generate 与 MCP Apply 使用相同的 cross-process output lock。Check/dry-run 不获取 exclusive lock；如果 writer active，它们会安全失败，而不是声称结果稳定 current。处理残留 transaction state 前，参见 [recovery](./mcp-write-recovery.md)。

Configured output 可以使用 `.openapi-to` 下的 default managed base，或 project root 下的 `base: 'workspace'`。Shared Core preflight 在 generation 前拒绝不安全或重叠的 output root。Ownership 跟随 resolved output root；Generation Intent 保持在 `.openapi-to/generation-intents`。Prepare 不创建任一 location。

使用 `--log-format json --log-level warn` 获取 newline-delimited operational stderr log。stdout 仅承载 MCP JSON-RPC。Repository development 使用 `pnpm test:mcp:all` 作为 complete bounded gate，使用 `pnpm mcp:check` 获取 synthetic built-bin health report，使用 `pnpm mcp:inspect` 进行 foreground authenticated manual review。Package 还保留独立的 benchmark、stress 和 Tool-selection evaluator；repository-only test/Doctor/Inspector script 不会 pack。Automated/manual boundary 见 [MCP test strategy](./testing/mcp-testing.md)。

Versioned baseline corpus 包含 1-operation small dialect fixture、150-operation/81-schema medium document、700-operation/301-schema multi-file large document、有界的 600-operation pathological document，以及 250-artifact generation fixture。Benchmark 创建 isolated temporary 250-file Workspace，测量重复 full Prepare/Apply timing。Stress 从 700/301 fixture seed 100 个 operation，通过 100 次重复 Selective Prepare 添加一个 operation，要求稳定的 101-operation projection 与有界 output/RSS，然后执行一次真实 selective Apply，并报告 discovery/compile wall time、Apply wall time、transaction staging/commit time、staged/backup/journal byte 和 final file count。Threshold 有意允许较大的 platform variance，且永不将 benchmark output 写入 repository。
