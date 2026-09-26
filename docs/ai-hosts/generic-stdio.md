# Generic MCP stdio Host

任何支持 local stdio process 的 MCP Host 都可以启动由 `openapi-to` 安装的 `openapi-to-mcp` command。Host 负责 process lifecycle、MCP initialization、Tool discovery、cancellation 和最终 Tool approval。

## 前置条件与安装（Prerequisites and installation）

- Node.js 22 or newer
- A Host with MCP stdio support
- A trusted local Workspace

Install the aggregate package:

```sh
pnpm add -D openapi-to
```

概念上的 process definition 为：

```json
{
  "transport": "stdio",
  "command": "pnpm",
  "args": ["exec", "--", "openapi-to-mcp", "--workspace-root", "."],
  "cwd": "."
}
```

请按 Host schema 调整外层 field name。不要添加 URL：本 server 没有 HTTP transport。

Native Windows process definition:

```json
{
  "transport": "stdio",
  "command": "cmd.exe",
  "args": ["/d", "/s", "/c", "pnpm exec -- openapi-to-mcp --workspace-root ."],
  "cwd": "."
}
```

Repository maintainer 调试 source checkout 时可以运行 `pnpm install` 和 `pnpm build`，然后使用 `node packages/mcp/bin/openapi-to-mcp.js --workspace-root .`；Windows 使用 `node.exe` 和 `packages\\mcp\\bin\\openapi-to-mcp.js`。这不是推荐的 installed-package workflow。

## Modes（模式）

No-config analysis-only:

```text
openapi-to-mcp --workspace-root .
```

Trusted-config Developer (default):

```text
openapi-to-mcp --workspace-root . --config ./openapi.config.ts
```

Developer exposes 8 Tools and `openapi_generate` may perform Core-validated,
Workspace-confined persistent generation for explicit implementation intent. To
force preview/check only, add `--generation-mode read-only`:

```text
openapi-to-mcp --workspace-root . --config ./openapi.config.ts --generation-mode read-only
```

Controlled Prepare/Apply:

```text
openapi-to-mcp --workspace-root . --config ./openapi.config.ts --generation-mode hardened
```

预期 Tool count 分别为 3、8（developer/read-only）和 10（hardened）。Host 应初始化 server、调用 `tools/list`；Developer implementation intent 直接使用统一 `openapi_generate`，Read-only 只使用 Dry Run，Hardened 才调用 `openapi_apply_generation` 并保持 write approval。Tool count 只用于 orientation，不等于批准调用它。

## Streams 与 lifecycle

Host 在 stdin/stdout 发送和接收 MCP JSON-RPC。stderr 用于有界 operational log 和 incidental plugin output。Wrapper 的任何 stdout banner 都应视为 protocol corruption。转发 cancellation，并在 session 结束时关闭 stdin 或干净地终止 child。

## Doctor、Inspector、error 与 security

Repository checkout 提供 `pnpm mcp:check` 和 foreground `pnpm mcp:inspect`；npm package 不包含这些 helper。Installed-package Host 应验证 `openapi-to-mcp --help`、initialization 和 `tools/list`。

参见 [troubleshooting](../troubleshooting.md) 和 [MCP security](../mcp-security.md)。Server 不提供 HTTP、OAuth、server API key、multi-tenancy、LLM call、background task 或 chat UI。

Remote Target configuration 与 Host 启动的 server 固定 startup policy 求 intersection。Explicit HTTP(S) root 是 caller-authorized；same-origin derived requests 自动允许，cross-origin `$ref` / redirect 需 allowedHosts。Tool call 不能注入 header 或扩大 derived host access；cross-origin 会清除 configured header，HTTPS-to-HTTP redirect 会被拒绝。
