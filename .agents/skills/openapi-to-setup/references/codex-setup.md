# Codex project setup

Automatic Host configuration in this phase is Codex-first and limited to the
trusted consuming project's `.codex/config.toml`. Claude Code, Cursor, and
generic stdio Hosts keep their existing documentation and require manual Host
configuration.

## macOS and Linux

Analysis-only (three Tools) omits `--config`:

```toml
[mcp_servers.openapi_to]
command = "pnpm"
args = ["exec", "--", "openapi-to-mcp", "--workspace-root", "."]
cwd = "<ABSOLUTE_PROJECT_ROOT>"
startup_timeout_sec = 10
tool_timeout_sec = 60
```

Configured Developer is the ordinary setup default. Omit `--generation-mode` and
let the MCP server's trusted-config default provide the Developer capability:

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
cwd = "<ABSOLUTE_PROJECT_ROOT>"
startup_timeout_sec = 10
tool_timeout_sec = 60
```

Use the exact discovered config filename when it is `.js`, `.cjs`, or `.mjs`.
Do not invent or rename a config.

Read-only is an explicit stricter mode. Add `--generation-mode read-only` when
the user asks for preview-only generation:

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
  "--generation-mode",
  "read-only"
]
cwd = "<ABSOLUTE_PROJECT_ROOT>"
startup_timeout_sec = 10
tool_timeout_sec = 60

```

Hardened is an explicit stricter mode. Add `--generation-mode hardened` and keep
the Apply prompt section. Developer direct writes use `openapi_generate`;
Read-only and Hardened `openapi_generate` are preview-only. Hardened persistent
writes require exact Prepare/approval/Apply. The legacy `--allow-write` flag is
rejected and is not a supported configuration.

```toml
[mcp_servers.openapi_to.tools.openapi_apply_generation]
approval_mode = "prompt"
```

## Native Windows

Use the repository's verified `cmd.exe` form because Hosts may not execute the
pnpm `.cmd` shim directly. The configured section is:

```toml
[mcp_servers.openapi_to]
command = "cmd.exe"
args = ["/d", "/s", "/c", "pnpm exec -- openapi-to-mcp --workspace-root . --config openapi.config.ts"]
cwd = "<ABSOLUTE_PROJECT_ROOT>"
startup_timeout_sec = 10
tool_timeout_sec = 60
```

For explicit Read-only or Hardened mode, add the matching `--generation-mode`
value inside the final command string; Hardened also uses the Apply prompt
section. Do not use POSIX absolute paths or machine-specific Node paths.

## File handling

- Missing file: a specifically approved plan may create the complete file.
- Existing file without `openapi_to`: an approved plan may append the exact
  bytes, preserving the original bytes and unknown sections and adding only the
  necessary newline separator.
- Exact legacy `cwd = "."` and exact canonical sections with a stale absolute
  root may be migrated in place after approval.
- Duplicate/custom section, unexpected absolute path, legacy `--allow-write`,
  missing Hardened Apply prompt, or unrecognized structure: report
  `manualReviewRequired` and do not apply automatically.

Never write environment values, headers, credentials, remote-network policy,
user-level Codex config, or unrelated MCP Server configuration.

## Restart and capability verification

Every Codex config write returns `RESTART_REQUIRED`. After the user restarts,
use Codex MCP status to verify the Server is connected, list actual Tool names,
and inspect relevant inputSchema:

| Directional count | Required capability evidence | State |
| ---: | --- | --- |
| 3 | validate, inspect, and diff names plus compatible current Schemas | `MCP_ANALYSIS_ONLY` |
| 8 | configured catalog/search/contract/check Tools plus `openapi_generate` with `write` and `dry-run`, or `dry-run` only | `MCP_DEVELOPER` or `MCP_READ_ONLY` respectively |
| 10 | the eight configured Tools plus Prepare/Apply and compatible Schemas; Host Apply prompt remains enabled | `MCP_HARDENED` |

Any other count is unknown. A matching count with missing names or incompatible
inputSchema is also unknown or `BLOCKED`. Tool results' capability fields take
part in the decision. Do not infer current-version arguments from names alone;
eight Tools alone cannot distinguish Developer from Read-only.
