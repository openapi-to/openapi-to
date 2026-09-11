# Use openapi-to MCP with Codex

Codex reads MCP servers from `config.toml`; a trusted project may use `.codex/config.toml`. Current fields for a local stdio server include `command`, `args`, `env`/`env_vars`, `cwd`, `startup_timeout_sec`, and `tool_timeout_sec`. This project requires Node.js 22 or newer. Do not commit a machine-specific absolute path.

The examples follow the current official [Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp). Project configuration is loaded only for trusted projects.

## Install

Install the aggregate package in the Workspace. It includes Core, the CLI, all official generators, and the `openapi-to-mcp` command:

```sh
pnpm add -D openapi-to
pnpm exec -- openapi-to-mcp --help
```

Most users do not need to install `@openapi-to/mcp` separately.

## Trusted-config read-only setup

Add this to the trusted project's `.codex/config.toml`:

```toml
[mcp_servers.openapi_to]
command = "pnpm"
args = [
  "exec",
  "--",
  "openapi-to-mcp",
  "--workspace-root",
  ".",
  "--config",
  "openapi.config.ts"
]
cwd = "."
startup_timeout_sec = 10
tool_timeout_sec = 60
```

This mode exposes eight read-only Tools: the three no-config analysis Tools plus target listing, operation search, bounded operation contract reading, generation dry-run, and generation check. Omit `--config` for the three-Tool analysis-only mode.

Native Windows can launch the package-manager shim through `cmd.exe`:

```toml
[mcp_servers.openapi_to]
command = "cmd.exe"
args = ["/d", "/s", "/c", "pnpm exec -- openapi-to-mcp --workspace-root . --config openapi.config.ts"]
cwd = "."
startup_timeout_sec = 10
tool_timeout_sec = 60
```

`tool_timeout_sec` is the Codex-side deadline. The Server also enforces its own per-Tool deadlines; configure those only in `args`, for example `"--validate-timeout-ms", "30000", "--generation-timeout-ms", "60000"`. Codex cancellation propagates to the active compiler/generator call and queued generation. The Server remains usable after cancellation.

For remote Targets, `input.remote` is the trusted access requirement while `--allow-host` and `--allow-private-network` are Codex Server operator ceilings. Both layers must permit the request. Tool calls cannot supply headers; configured headers are retained only on same-Origin redirects, removed cross-Origin, and never sent through an HTTPS-to-HTTP downgrade.

## Controlled writes

To expose Prepare/Apply, the Server operator must add `--allow-write`, and Codex must continue to prompt before Apply:

```toml
[mcp_servers.openapi_to]
command = "pnpm"
args = [
  "exec",
  "--",
  "openapi-to-mcp",
  "--workspace-root",
  ".",
  "--config",
  "openapi.config.ts",
  "--allow-write"
]
cwd = "."
startup_timeout_sec = 10
tool_timeout_sec = 120

[mcp_servers.openapi_to.tools.openapi_apply_generation]
approval_mode = "prompt"
```

This produces ten Tools. Codex should call `openapi_prepare_generation` first, tell the user the added/modified/deleted summary and exact plan hash, and wait. It may call `openapi_apply_generation` only after the user explicitly approves that one unexpired plan. “Generate”, “update”, “continue”, a freshness check, or a preview request is not sufficient confirmation. When more than one plan is in context, Codex must ask which hash; it must never guess. A stale or expired rejection requires a new Prepare and a new confirmation, not an automatic Prepare-then-Apply chain.

Tool counts do not establish argument compatibility across local package
versions. Codex must inspect each relevant current Tool inputSchema as well as
the actual Tool list. Operation-scoped Dry Run requires Schema support for its
operations scope and exactly one explicit, grounded Target. Selective Prepare
requires Schema support for `selection`; `replace` is version-sensitive and is
allowed only when `selection.type = replace` is explicitly present. If Codex
cannot inspect inputSchema, it reports that gap and fails closed for unverified
version-sensitive behavior. Missing selective support never justifies
full-target generation or a dependency upgrade.

For persistent project intent, Codex may pass `selection: { type: "add", operationKeys: [...] }` to compute `desired = previous ∪ requested`, or a non-empty `selection: { type: "replace", operationKeys: [...] }` to compute `desired = requested`. Replace may remove operations and must be reviewed for managed deletions; an empty replace is not clear. Codex should compare the returned mutation type plus previous/requested/new/already-selected/retained/removed/desired summaries and counts, projection counts, change summary, truncation diagnostics, and exact plan hash. Prepare writes neither selection nor generated output, but a successful selective plan has `applySupported: true` and a one-time token. Only after explicit approval may Codex call Apply with the returned plan ID, token, and exact approved hash. Apply cannot accept or infer operation keys, a path, config, source, plugin, content, or cleanup policy. Omit `selection` for the unchanged full Prepare/Apply workflow; remove, clear, prune, historical full-output migration, and rename migration remain unsupported.

`--allow-write` is an operator capability grant, not proof of human approval. The Server cryptographically binds Apply to the Prepare result but relies on Codex and Host Tool approval for the final interaction boundary. Review managed deletions carefully. There is no force, dynamic target/path/content override, OpenAPI edit, or arbitrary file write.

## Repository development mode

Maintainers debugging a source checkout can build and launch the source bin:

```sh
pnpm install
pnpm build
node packages/mcp/bin/openapi-to-mcp.js --workspace-root .
```

This is a repository development workflow, not the recommended user installation. The `pnpm mcp:check` and foreground `pnpm mcp:inspect` helpers are also repository-only and are intentionally absent from the published `openapi-to` package.

Restart Codex after configuration or OpenAPI target changes. Use `/mcp` in the Codex terminal UI or the MCP servers settings page in the desktop app/IDE extension to confirm the server and Tools. A server without config shows three Tools; a server with config shows eight; config plus `--allow-write` shows ten.

See [getting started](./getting-started.md), [troubleshooting](./troubleshooting.md), and the shared [MCP security boundary](./mcp-security.md). The server is local stdio only. stdout is MCP JSON-RPC; operational logs use stderr. It does not provide HTTP, OAuth, multi-tenancy, LLM calls, or a chat UI.

Once this trusted Server is available, the Phase 1
[`openapi-to-generate` consumer Skill](./skills.md) gives Codex the bounded
Operation discovery, operation-scoped Dry Run, exact-plan approval, Apply, and
business integration sequence. It uses the consuming project's local
openapi-to version, actual Tool list, and current Tool inputSchema; setup
automation remains outside this stage. The Phase 2
[`openapi-to-setup` Skill](./setup-skill.md) owns that diagnosis and
configuration boundary. It defaults to read-only, uses the existing
`openapi init`, does not upgrade an existing version, requires an exact Setup
Plan ID for writes, and returns `RESTART_REQUIRED` after changing this file.
After restart it treats 3/8/10 only as orientation and verifies the actual Tool
list, current Tool inputSchema, and returned capability fields.

The phase labels are historical: Phase 2.1 hardened Setup state binding and
Phase 2.2 added Windows portable verified reads. They are not new Skills, and
the operational order remains Setup first, then Generate.

For maintainers, `pnpm release:smoke` is the canonical full packed consumer
acceptance entry. Its narrow Setup-to-MCP bridge writes these supported
project-relative Host forms in a repository-external temporary consumer,
compares the repository-Skill Inspector's inferred mode with the named Tools
from the locally packed MCP, checks current Tool Schemas, and invalidates the
handoff after `observedStateHash` drift. It neither reads a user's
`~/.codex` nor claims the Inspector is part of the npm tarball. See the
[consumer acceptance coverage matrix](./testing/consumer-acceptance-matrix.md).
