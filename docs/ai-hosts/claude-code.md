# Claude Code

Claude Code 可以将由 `openapi-to` 安装的 `openapi-to-mcp` command 启动为 local stdio server。下方 project-scoped `.mcp.json` format 与 `claude mcp add` command 遵循官方 [Claude Code MCP documentation](https://docs.anthropic.com/en/docs/claude-code/mcp)。

## 前置条件与安装（Prerequisites and installation）

- Node.js 22 or newer
- Claude Code installed and authenticated
- A trusted local Workspace

在该 Workspace 安装 aggregate package：

```sh
pnpm add -D openapi-to
```

Repository maintainer 调试 source 时，也可以运行 `pnpm install` 和 `pnpm build`，再启动 `node packages/mcp/bin/openapi-to-mcp.js`。

## 最小 read-only setup

Installed package on macOS/Linux:

```sh
claude mcp add --scope local openapi-to -- pnpm exec -- openapi-to-mcp --workspace-root .
```

Native Windows:

```powershell
claude mcp add --scope local openapi-to -- cmd /c pnpm exec -- openapi-to-mcp --workspace-root .
```

也可以 review 后提交 project-scoped `.mcp.json`：

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

Native Windows equivalent:

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

Claude Code 在接受 project-scoped server 前会询问。使用 `claude mcp list`、`claude mcp get openapi-to` 或 `/mcp` 验证配置。

## Trusted config 与 controlled write

为八个 read-only configured-mode Tool 添加 Workspace-local config：

```sh
claude mcp add --scope local openapi-to -- pnpm exec -- openapi-to-mcp --workspace-root . --config ./openapi.config.ts
```

只有需要 Hardened Prepare/Apply 时才添加 `--generation-mode hardened`：

```sh
claude mcp add --scope local openapi-to -- pnpm exec -- openapi-to-mcp --workspace-root . --config ./openapi.config.ts --generation-mode hardened
```

对 `openapi_apply_generation` 保持 Claude Code Tool approval。Prepare 不写入；Apply 要求 exact unexpired plan ID、token 和 approved hash，并继续通过 Workspace、stale-state、output-lock、transaction 与 rollback check。`--generation-mode hardened` 不授予跳过 Host approval 的权限。

## Source checkout

Maintainer-only POSIX `.mcp.json` command:

```json
{
  "mcpServers": {
    "openapi-to-source": {
      "command": "node",
      "args": ["packages/mcp/bin/openapi-to-mcp.js", "--workspace-root", "."]
    }
  }
}
```

On Windows use `"command": "node.exe"` and `"args": ["packages\\mcp\\bin\\openapi-to-mcp.js", "--workspace-root", "."]`.

## Doctor、Inspector、error 与 security

在 repository root 使用 `pnpm mcp:check` 获取 non-interactive built-bin health report，使用 `pnpm mcp:inspect` 进行 foreground manual review。这些 helper 不包含在 npm package 中。

连接、Windows、config、logging 与 stale-plan failure 见 [troubleshooting](../troubleshooting.md)；启用 write 前先阅读 [MCP security](../mcp-security.md)。Server 仅 stdio，不提供 HTTP、OAuth、multi-tenancy、LLM call 或 chat UI。

Remote Target configuration 与固定的 server startup policy 求 intersection。Explicit HTTP(S) root 是 caller-authorized；same-origin derived requests 自动允许，cross-origin `$ref` / redirect 需 allowedHosts。Tool call 不能注入 header 或扩大 derived host access；cross-origin 会清除 configured header，HTTPS-to-HTTP redirect 会被拒绝。
