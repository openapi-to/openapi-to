# Cursor

Cursor can launch the `openapi-to-mcp` command installed by `openapi-to` as a local stdio server. Project configuration lives in `.cursor/mcp.json`; user configuration lives in `~/.cursor/mcp.json`, as documented by Cursor's official [MCP guide](https://docs.cursor.com/context/model-context-protocol).

## Prerequisites and installation

- Node.js 22 or newer
- Cursor with MCP support
- A trusted local Workspace

Install the aggregate package:

```sh
pnpm add -D openapi-to
```

Repository maintainers debugging source can run `pnpm install` and `pnpm build` before launching the source bin; this is not the recommended installed-package workflow.

## Minimal read-only setup

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

Restart Cursor, open MCP settings, and confirm three Tools. Cursor asks for Tool approval by default. Do not enable auto-run for `openapi_apply_generation`.

## Trusted config and controlled write

Configured read-only mode:

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

Append `"--allow-write"` to `args` only when the two controlled write Tools are required. It exposes Prepare/Apply but does not bypass Cursor approval. Prepare writes nothing; Apply accepts only the exact plan ID, one-time token, and approved hash and revalidates Workspace/config/source/output state under the shared output lock.

## Source checkout

Maintainers can use `"command": "node"` with `"args": ["packages/mcp/bin/openapi-to-mcp.js", "--workspace-root", "."]`. On Windows use `node.exe` and `packages\\mcp\\bin\\openapi-to-mcp.js`.

## Doctor, Inspector, errors, and security

Repository maintainers can run `pnpm mcp:check` and the foreground `pnpm mcp:inspect`. Those helpers are intentionally not packed.

See [troubleshooting](../troubleshooting.md) and [MCP security](../mcp-security.md). stdout must remain MCP JSON-RPC and operational logs stay on stderr. This server does not implement HTTP, OAuth, multi-tenancy, LLM calls, or a chat UI.

Remote Target configuration is intersected with Cursor's fixed server startup policy. Tool calls cannot inject headers or broaden hosts/private-network access; cross-Origin redirects clear configured headers and HTTPS-to-HTTP redirects are rejected.
