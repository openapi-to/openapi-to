# Cursor

Cursor 可以将由 `openapi-to` 安装的 `openapi-to-mcp` command 启动为 local stdio server。Project config 位于 `.cursor/mcp.json`；user config 位于 `~/.cursor/mcp.json`，详见 Cursor 官方 [MCP guide](https://docs.cursor.com/context/model-context-protocol)。

## 前置条件与安装（Prerequisites and installation）

- Node.js 22 or newer
- Cursor with MCP support
- A trusted local Workspace

安装 aggregate package：

```sh
pnpm add -D openapi-to
```

Repository maintainer 调试 source 时可以先运行 `pnpm install` 和 `pnpm build`，再启动 source bin；这不是推荐的 installed-package workflow。

## 最小 read-only setup

Create `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "openapi-to": {
      "command": "pnpm",
      "args": ["exec", "--", "openapi-to-mcp", "--workspace-root", "."]
    }
  }
}
```

Native Windows:

```json
{
  "mcpServers": {
    "openapi-to": {
      "command": "cmd.exe",
      "args": ["/d", "/s", "/c", "pnpm exec -- openapi-to-mcp --workspace-root ."]
    }
  }
}
```

Restart Cursor，打开 MCP settings，并确认三个 Tool。Cursor 默认会询问 Tool approval。不要为 `openapi_apply_generation` 启用 auto-run。

## Trusted config 与 controlled write

Configured read-only mode：

```json
{
  "mcpServers": {
    "openapi-to": {
      "command": "pnpm",
      "args": [
        "exec",
        "--",
        "openapi-to-mcp",
        "--workspace-root",
        ".",
        "--config",
        "./openapi.config.ts"
      ]
    }
  }
}
```

只有需要两个 controlled write Tool 时才在 `args` 追加 `"--allow-write"`。它会暴露 Prepare/Apply，但不会绕过 Cursor approval。Prepare 不写入；Apply 只接受 exact plan ID、one-time token 和 approved hash，并在 shared output lock 下重新验证 Workspace/config/source/output state。

## Source checkout

Maintainers can use `"command": "node"` with `"args": ["packages/mcp/bin/openapi-to-mcp.js", "--workspace-root", "."]`. On Windows use `node.exe` and `packages\\mcp\\bin\\openapi-to-mcp.js`.

## Doctor、Inspector、error 与 security

Repository maintainer 可以运行 `pnpm mcp:check` 和 foreground `pnpm mcp:inspect`；这些 helper 有意不打包。

参见 [troubleshooting](../troubleshooting.md) 和 [MCP security](../mcp-security.md)。stdout 必须保持 MCP JSON-RPC，operational log 留在 stderr。Server 不实现 HTTP、OAuth、multi-tenancy、LLM call 或 chat UI。

Remote Target configuration 与 Cursor 固定的 server startup policy 求 intersection。Tool call 不能注入 header 或扩大 host/private-network access；cross-Origin redirect 会清除 configured header，HTTPS-to-HTTP redirect 会被拒绝。
