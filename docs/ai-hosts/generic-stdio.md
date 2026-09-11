# Generic MCP stdio Host

Any MCP Host that supports local stdio processes can launch the `openapi-to-mcp` command installed by `openapi-to`. The Host owns process lifecycle, MCP initialization, Tool discovery, cancellation, and final Tool approval.

## Prerequisites and installation

- Node.js 22 or newer
- A Host with MCP stdio support
- A trusted local Workspace

Install the aggregate package:

```sh
pnpm add -D openapi-to
```

The conceptual process definition is:

```json
{
  "transport": "stdio",
  "command": "pnpm",
  "args": ["exec", "--", "openapi-to-mcp", "--workspace-root", "."],
  "cwd": "."
}
```

Adapt the outer field names to the Host's schema. Do not add a URL: this server has no HTTP transport.

Native Windows process definition:

```json
{
  "transport": "stdio",
  "command": "cmd.exe",
  "args": ["/d", "/s", "/c", "pnpm exec -- openapi-to-mcp --workspace-root ."],
  "cwd": "."
}
```

Repository maintainers debugging a source checkout can run `pnpm install` and `pnpm build`, then use `node packages/mcp/bin/openapi-to-mcp.js --workspace-root .`; on Windows use `node.exe` and `packages\\mcp\\bin\\openapi-to-mcp.js`. This is not the recommended installed-package workflow.

## Modes

Read-only analysis:

```text
openapi-to-mcp --workspace-root .
```

Trusted-config read-only catalog/preview/check:

```text
openapi-to-mcp --workspace-root . --config ./openapi.config.ts
```

Controlled Prepare/Apply:

```text
openapi-to-mcp --workspace-root . --config ./openapi.config.ts --allow-write
```

The expected Tool counts are 3, 8, and 10 respectively. A Host should initialize the server, call `tools/list`, and keep write approval enabled for `openapi_apply_generation`. `--allow-write` only makes that Tool available; it is not approval to call it.

## Streams and lifecycle

The Host sends and receives MCP JSON-RPC on stdin/stdout. stderr is for bounded operational logs and incidental plugin output. Treat any stdout banner from a wrapper as protocol corruption. Forward cancellation and close stdin or terminate the child cleanly when the session ends.

## Doctor, Inspector, errors, and security

Repository checkouts provide `pnpm mcp:check` and foreground `pnpm mcp:inspect`; the npm package does not include those helpers. An installed-package Host should verify `openapi-to-mcp --help`, initialization, and `tools/list`.

See [troubleshooting](../troubleshooting.md) and [MCP security](../mcp-security.md). The server does not provide HTTP, OAuth, server API keys, multi-tenancy, LLM calls, background tasks, or a chat UI.

Remote Target configuration is intersected with the Host-launched server's fixed startup policy. Tool calls cannot inject headers or broaden hosts/private-network access; cross-Origin redirects clear configured headers and HTTPS-to-HTTP redirects are rejected.
