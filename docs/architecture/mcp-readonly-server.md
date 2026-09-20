# Read-only MCP server architecture（Read-only MCP Server 架构）

状态：P2 read-only foundation 已接受（2026-07-18），并由 Phase 1 trusted-target Operation Catalog 扩展。当前 configured read-only matrix 为八个 Tool；下方历史 P2 evidence 保留其原始的 five-Tool wording。

## Decision

Phase 1 在 five-Tool P2 configured-mode foundation 上增加固定的 target-list、operation-search 和 single-contract Tool。当前 3/8/10 matrix 与 limits 见 [Operation Catalog and bounded contract discovery](./operation-catalog.md)。

发布独立的 `@openapi-to/mcp` package，通过 stdio 暴露八个有界的 read-only MCP Tool。Server 使用 `@modelcontextprotocol/sdk` **1.30.0**，即 repository 选定的 v1 maintenance-line package。官方 SDK 现在另有使用 split package 的 v2 stable line；由于当前 implementation、imports 和 release surface 尚未迁移，本 repository 仍使用 monolithic v1 package。Package 在 `package.json` 和 `pnpm-lock.yaml` pin 1.30.0，并使用 Zod **4.6.3**（repository 的 exact MCP runtime pin），不会在 repository 的 Zod 4 consumer 旁重新引入 Zod 3 runtime。

Stable protocol target 是 MCP revision **2025-11-25**。Server 不 hard-code protocol version；由 SDK 执行 initialization negotiation。

SDK package 自身声明 Node.js 18 或更新版本。Repository development 和 test command 要求 Node.js **22.13 或更新版本**；每个 public `openapi-to` runtime package 仍保持 **22 或更新版本**的 `engines.node` floor。因此 `@openapi-to/mcp` 保持 published-package runtime contract。

主要参考：[official TypeScript SDK v1 maintenance line](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x)、[official TypeScript SDK v2 server package](https://github.com/modelcontextprotocol/typescript-sdk/tree/main/packages/server)、[this server's protocol specification](https://modelcontextprotocol.io/specification/2025-11-25) 和 [tool schema](https://modelcontextprotocol.io/specification/2025-11-25/schema)。

## 为什么优先使用 stdio

Codex 和其他 local MCP Host 可以 spawn stdio Server，不需要 listening socket、HTTP routing、authentication、CORS、DNS-rebinding、session 或 deployment surface。stdin 和 stdout 始终只承载 MCP JSON-RPC；所有有界 log 与 plugin incidental console output 都进入 stderr。本 MVP 有意不包含 Streamable HTTP server、OAuth、API key、resource、prompt、sampling、elicitation、task、Apps UI 或 LLM code。

## 为什么选择 stable SDK v1

`@modelcontextprotocol/sdk` 1.30.0 是选定的 v1 maintenance-line package，支持所需的 `McpServer`、stdio transport、tool annotation、`outputSchema` 和 `structuredContent`。当前 v2 stable line 使用 split 的 `@modelcontextprotocol/server` 与 `@modelcontextprotocol/client` package，并面向更新的 protocol revision。同时兼容 v1/v2 会扩大 protocol 和 test surface，而 repository 当前没有这一要求。

迁移到 v2 仍是独立 change，需要明确的 compatibility decision、更新 imports 与 package surface、protocol/Host support review，以及针对 split package 的完整 stdio/schema/error/security/release matrix。Streamable HTTP 需要独立的 deployment threat model、authentication decision、host/origin controls、session/load-balancing design 和 operator demand。

## Direct Core boundary

依赖方向为：

```text
MCP protocol adapter
        ↓
MCP application/security service
        ↓
@openapi-to/core public API
```

Tool 直接调用 `compileOpenAPI`、`inspectOpenAPIDocument`、`diffOpenAPIDocuments`、`build`、Diagnostics 和 Artifact/Manifest API。spawn `openapi-to` 再解析 CLI stdout 会引入 process、presentation、escaping、error-code 和 stdout-contamination failure mode，并把一个 machine interface 与另一个绑定。

## Workspace boundary

Server creation 使用 `realpath` canonicalize 一个 `workspaceRoot`。MCP 使用 resolved path、`lstat`、`realpath` 和 `relative` 验证 local entry/config/output/check path；拒绝 traversal、absolute escape、symlink escape、不兼容平台上的 Windows drive/UNC input，以及最近 existing ancestor 逃逸的 output path。Core 的 optional `localFileRoot` 在 Loader 和 Resolver read 期间应用相同 boundary，因此 transitive local `$ref` 不能逃逸。省略该 option 的 CLI caller 保持既有行为。

Artifact comparison 保留 Core 的 path confinement、symlink check、managed ownership manifest 和 case-folded collision detection。Dry-run 与 check 只以 non-writing mode 调用 `build`，绝不调用 writer。

## Trusted configuration

TypeScript/JavaScript configuration 是 executable project code。只有 Server operator 可以选择 `--config`；Tool argument 不能替换它、注入 plugins/code/packages/shell/env、改变 output root 或放宽 network policy。该 path 必须在 Workspace 内且不能 symlink escape。Core shared loader 使用 bundler boundary plugin，在 module execution 前拒绝 Workspace 外的 bundled local config import。Bare installed package import 仍属于 operator-trusted project dependency graph。

每个 server 只创建并缓存一次 configuration Promise，包括 failure。文件变化要等 Host restart server 后才会观察到。只有提供 startup config path 时才注册 generation tool，因此一次 connection 内的 `tools/list` 保持稳定。

## Read-only tools and state

无 config：`openapi_validate`、`openapi_inspect`、`openapi_diff`。有 config：再加上 `openapi_list_targets`、`openapi_search_operations`、`openapi_get_operation`、统一 `openapi_generate` 和 `openapi_check_generation`。Developer、read-only、hardened 的 capability 由 startup mode 决定；Catalog call 共享 process-local、target-isolated compile Promise cache；其他 analysis call 使用独立 compile state，可并发运行。Generation call 每个 server instance 使用一个 `GenerationLock`；`finally` release 防止失败调用阻塞 queue，不同 instance 不共享 lock。

所有 result 使用 stable schema、简短 text summary、有界 `structuredContent`、排序后的 diagnostics/changes/artifacts、total 与 omitted count，以及 `MCP_RESULT_TRUNCATED` warning。预期 execution failure 返回 `isError: true`；invalid tool argument 与 MCP lifecycle failure 仍是 protocol-level error。Source、diagnostic、cause 和 log 会 redact Workspace prefix、URL credential/query string、authorization/cookie/token-like value、stack/config/document/generated body 和 binary content。

Read-only mode 的八个 tool 保持无写入。Developer mode 的统一 `openapi_generate` 可以持久化 Core-validated intent；Hardened mode 仍通过独立的 operator-gated Prepare/Apply protocol，包含 explicit authorization、plan binding、revalidation、filesystem locking、rollback 和 crash recovery；两条路径共用 Core writer。参见 [controlled MCP generation write architecture](./mcp-controlled-write.md)。

## Protocol smoke evidence

MCP Inspector **0.22.0** 已在 2026-07-18 对照其 current official CLI help，并用于 built stdio bin。成功与预期错误调用如下：

```bash
npx --yes --package @modelcontextprotocol/inspector@0.22.0 \
  mcp-inspector --cli -- \
  node packages/mcp/bin/openapi-to-mcp.js --workspace-root . \
  --method tools/list

npx --yes --package @modelcontextprotocol/inspector@0.22.0 \
  mcp-inspector --cli -- \
  node packages/mcp/bin/openapi-to-mcp.js --workspace-root . \
  --method tools/call --tool-name openapi_validate \
  --tool-arg source=packages/mcp/src/fixtures/valid.yaml

npx --yes --package @modelcontextprotocol/inspector@0.22.0 \
  mcp-inspector --cli -- \
  node packages/mcp/bin/openapi-to-mcp.js --workspace-root . \
  --method tools/call --tool-name openapi_validate \
  --tool-arg source=../outside.yaml
```

不带 config 的 list 暴露三个 tool，并包含 input/output schema 与 read-only annotation；valid call 返回 OpenAPI 3.1.0；escape 返回 `isError: true` 与 `MCP_WORKSPACE_PATH_OUTSIDE_ROOT`。本地 npm wrapper 在查询 version 时尝试启动 Inspector UI，因此 smoke 直接调用安装的 0.22.0 package CLI entry；这只改变 command dispatch，不改变 Inspector client implementation。

随后使用与 `docs/codex-mcp.md` 匹配的 ephemeral、read-only session 和 configuration override 运行 Codex CLI。Codex 发现 `openapi_to` 并调用全部五个 tool。Validate 与 inspect 成功；diff 返回一个 breaking 和一个 non-breaking change；dry-run 返回一个 planned artifact 且未创建 output directory；check 返回预期 structured outdated result 且未写入。Smoke 未使用 committed machine-specific Codex configuration。

## P2.5 protocol and SDK revalidation

已于 **2026-09-14** 对照已合入的 #89 dependency update 和当前 repository tree 重新验证：该 server 的 v1 SDK target 仍为 **1.30.0**，exact MCP Zod runtime 为 **4.6.3**，negotiated protocol target 仍为 **2025-11-25**。官方 SDK 现在有使用 split package 的 v2 stable line，以及更新的 [2026-07-28 protocol revision](https://modelcontextprotocol.io/specification/2026-07-28)；本 repository 尚未迁移，因此 v2 protocol 不是本 server 的 implemented capability。下方历史 smoke evidence 使用 Inspector **0.22.0**。Codex 当前为 MCP Server 记录 `startup_timeout_sec`（默认 10 秒）和 `tool_timeout_sec`（默认 60 秒）。

Stable SDK v1 暴露 `RequestHandlerExtra.signal`、`_meta.progressToken` 和 `sendNotification`。因此 Server 会传播 request cancellation；client 提供 token 时，仅发送 coarse standard `notifications/progress` notification。不使用 experimental Tasks，也不手写 cancellation/progress JSON-RPC。来源：[cancellation](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation)、[progress](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/progress)、[TypeScript SDK v1 maintenance line](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x) 和 [Codex MCP configuration](https://developers.openai.com/codex/mcp/)。

Server timeout 是 invocation-scoped AbortSignal，与 client 和 HTTP timeout 分离。默认值基于 versioned synthetic corpus，并限制在 100–600000 ms。Timer 与 listener 在 `finally` release。Analysis 使用 call-local state；generation 按 Server instance 串行化，cancelled waiter 只在前一个 position 完成后释放其 queue position，以保持顺序。

Local source/config read 使用 opened handle 以及 pre/open/post identity 和 metadata check。这会缩小 TOCTOU window，但不声称消除所有 hostile same-user filesystem race。检测到变化时 fail closed。Trusted config 缓存于 Server lifetime，因此 config edit 需要 restart。

P2.5 Inspector smoke 使用实际的 0.22.0 bin 和 current help syntax：

```bash
npx --yes --package @modelcontextprotocol/inspector@0.22.0 \
  mcp-inspector --cli -- node packages/mcp/bin/openapi-to-mcp.js \
  --workspace-root . --method tools/list

npx --yes --package @modelcontextprotocol/inspector@0.22.0 \
  mcp-inspector --cli -- node packages/mcp/bin/openapi-to-mcp.js \
  --workspace-root . --method tools/call --tool-name openapi_validate \
  --tool-arg source=packages/mcp/src/evaluation/fixtures/large/openapi.json
```

它恰好暴露三个 no-config tool，并带有 input/output schema、annotation，且禁止 task support；700-operation local validate 成功。Escape case `source=../outside.yaml` 返回 `isError: true` 与 `MCP_WORKSPACE_PATH_OUTSIDE_ROOT`。stderr 未破坏 connection。

真实 Codex CLI selection evaluation 针对 five-tool configured Server 运行了 17 个独立 ephemeral read-only session。观察到 **100% tool selection**、**94.1% strict argument accuracy**、**0% unnecessary calls** 和 **0% forbidden calls**。唯一一次 argument miss 省略了 dry-run 的 optional target restriction；由于 fixture config 只有一个 target，execution 仍为 read-only，并选择了预期的 startup-trusted target。固定阈值为 80% tool/argument accuracy，且 unnecessary calls 不超过 10%。
