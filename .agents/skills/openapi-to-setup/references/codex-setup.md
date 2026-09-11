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
cwd = "."
startup_timeout_sec = 10
tool_timeout_sec = 60
```

Read-only is the default for an ambiguous setup request:

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

Use the exact discovered config filename when it is `.js`, `.cjs`, or `.mjs`.
Do not invent or rename a config.

Write-enabled requires explicit user intent, adds `--allow-write`, and keeps
Apply in prompt approval mode:

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
tool_timeout_sec = 60

[mcp_servers.openapi_to.tools.openapi_apply_generation]
approval_mode = "prompt"
```

`--allow-write` grants Server capability only. It is not approval of a Setup
Plan and not approval of an MCP generation Apply plan.

## Native Windows

Use the repository's verified `cmd.exe` form because Hosts may not execute the
pnpm `.cmd` shim directly. The read-only section is:

```toml
[mcp_servers.openapi_to]
command = "cmd.exe"
args = ["/d", "/s", "/c", "pnpm exec -- openapi-to-mcp --workspace-root . --config openapi.config.ts"]
cwd = "."
startup_timeout_sec = 10
tool_timeout_sec = 60
```

For explicit write-enabled mode, add `--allow-write` inside the final command
string and the same prompt section shown above. Do not use POSIX absolute paths
or machine-specific Node paths.

## File handling

- Missing file: a specifically approved plan may create the complete file.
- Existing file without `openapi_to`: an approved plan may append the exact
  bytes, preserving the original bytes and unknown sections and adding only the
  necessary newline separator.
- Existing `openapi_to` section: manual review by default. Do not overwrite,
  remove, reorder, or parse-and-rewrite the file.
- Duplicate section, absolute path, `--allow-write` without Apply prompt, or
  unrecognized structure: report `manualReviewRequired` and an advisory diff;
  do not apply automatically.

Never write environment values, headers, credentials, remote-network policy,
user-level Codex config, or unrelated MCP Server configuration.

## Restart and capability verification

Every Codex config write returns `RESTART_REQUIRED`. After the user restarts,
use Codex MCP status to verify the Server is connected, list actual Tool names,
and inspect relevant inputSchema:

| Directional count | Required capability evidence | State |
| ---: | --- | --- |
| 3 | validate, inspect, and diff names plus compatible current Schemas | `MCP_ANALYSIS_ONLY` |
| 8 | the three analysis Tools plus configured catalog/search/contract/dry-run/check Tools and compatible Schemas | `MCP_READ_ONLY` |
| 10 | the read-only set plus Prepare/Apply and compatible Schemas; Host Apply prompt remains enabled | `MCP_WRITE_ENABLED` |

Any other count is unknown. A matching count with missing names or incompatible
inputSchema is also unknown or `BLOCKED`. Tool results' capability fields take
part in the decision. Do not infer current-version arguments from names alone.
