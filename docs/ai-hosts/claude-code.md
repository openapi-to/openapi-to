# Claude Code

Claude Code can launch the `openapi-to-mcp` command installed by `openapi-to` as a local stdio server. The project-scoped `.mcp.json` format and `claude mcp add` commands below follow the official [Claude Code MCP documentation](https://docs.anthropic.com/en/docs/claude-code/mcp).

## Prerequisites and installation

- Node.js 22 or newer
- Claude Code installed and authenticated
- A trusted local Workspace

Install the aggregate package in that Workspace:

```sh
pnpm add -D openapi-to
```

Repository maintainers debugging source can instead run `pnpm install` and `pnpm build`, then launch `node packages/mcp/bin/openapi-to-mcp.js`.

## Minimal read-only setup

Installed package on macOS/Linux:

```sh
claude mcp add --scope local openapi-to -- pnpm exec -- openapi-to-mcp --workspace-root .
```

Native Windows:

```powershell
claude mcp add --scope local openapi-to -- cmd /c pnpm exec -- openapi-to-mcp --workspace-root .
```

Or commit a project-scoped `.mcp.json` after reviewing it:

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

Claude Code asks before accepting a project-scoped server. Use `claude mcp list`, `claude mcp get openapi-to`, or `/mcp` to verify it.

## Trusted config and controlled write

Add a Workspace-local config for the eight read-only configured-mode Tools:

```sh
claude mcp add --scope local openapi-to -- pnpm exec -- openapi-to-mcp --workspace-root . --config ./openapi.config.ts
```

Add `--allow-write` only when Prepare/Apply is required:

```sh
claude mcp add --scope local openapi-to -- pnpm exec -- openapi-to-mcp --workspace-root . --config ./openapi.config.ts --allow-write
```

Keep Claude Code Tool approval enabled for `openapi_apply_generation`. Prepare writes nothing; Apply requires the exact unexpired plan ID, token, and approved hash and still passes Workspace, stale-state, output-lock, transaction, and rollback checks. `--allow-write` does not grant permission to skip Host approval.

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

## Doctor, Inspector, errors, and security

From the repository root, use `pnpm mcp:check` for a non-interactive built-bin health report and `pnpm mcp:inspect` for foreground manual review. These helpers are not included in the npm package.

See [troubleshooting](../troubleshooting.md) for connection, Windows, config, logging, and stale-plan failures. See [MCP security](../mcp-security.md) before enabling writes. The server is stdio-only and does not provide HTTP, OAuth, multi-tenancy, LLM calls, or a chat UI.

Remote Target configuration is intersected with the fixed server startup policy. Tool calls cannot inject headers or broaden hosts/private-network access; cross-Origin redirects clear configured headers and HTTPS-to-HTTP redirects are rejected.
