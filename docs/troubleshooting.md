# Troubleshooting

## The Host reports “connection closed”

Run the same command from the Workspace first:

```sh
pnpm exec openapi-to-mcp --help
```

For a source checkout, run `pnpm build` before `node packages/mcp/bin/openapi-to-mcp.js`. Confirm Node.js is 22.13 or newer for repository commands, and that the Host starts the process with the intended Workspace as its working directory. Published packages retain a Node.js 22 or newer runtime floor.

On native Windows, JSON/TOML Hosts may not execute `.cmd` shims directly. Use `command: "cmd.exe"` with `/d /s /c` and a complete `pnpm exec openapi-to-mcp ...` command, or use `node.exe` with the source bin path. Do not copy POSIX `/path/...` examples into a Windows configuration.

## The Host shows no Tools

The process must stay open on stdio. Confirm that no wrapper prints to stdout and that Host configuration uses the stdio `command`/`args` form rather than an HTTP URL. Restart the Host after changing config.

Expected Tool counts are:

- 3 without `--config`
- 8 with trusted `--config`
- 10 with trusted `--config` and `--allow-write`

## Configured Tools are missing

The config path must exist inside the Workspace, may not escape through a symlink, and must export a valid project configuration. It is trusted executable code selected at startup and cached for the server lifetime. Restart after changing the config or OpenAPI source.

`--allow-write` without `--config` is rejected. Output roots must also pass Workspace validation before write Tools are registered.

For CLI auto-discovery, keep exactly one of `openapi.config.ts`, `.js`, `.cjs`,
or `.mjs` in the nearest configuration directory. `OPENAPI_CONFIG_AMBIGUOUS`
means more than one candidate exists; remove the unintended file or pass an
explicit `--config <path>`. Files below `.openapi-to` or the former state
directory are not auto-discovered.

## JSON-RPC is polluted

stdout is reserved for MCP protocol messages. Send diagnostics, banners, debug output, and plugin incidental logging to stderr. When embedding the server, do not use a wrapper that writes its own status line to stdout.

Use `--log-level debug` only while diagnosing and keep logs on stderr. For structured operational logs use `--log-format json`; this is NDJSON on stderr, not Tool-result JSON.

## A local or remote source is rejected

Local sources and transitive local `$ref` values must remain inside the real Workspace. Fix traversal/symlink escapes rather than broadening the Workspace.

Remote inputs allow HTTP(S) only and deny private/reserved addresses by default. The operator may add repeatable `--allow-host <hostname>` values. `--allow-private-network` deliberately lowers the security boundary and should be used only for a trusted internal source.

## Generation check reports outdated

This is an expected business result, not an MCP protocol failure. Review the bounded change summary. In write-enabled mode call Prepare, review its exact hash and changes, then approve the corresponding Apply according to Host policy. Do not automatically Prepare and Apply.

With the CLI, `openapi generate --target <name> --check` checks only the selected Target. If a name is unknown, inspect the explicit `servers[].name` values; legacy `server1`, `server2` fallbacks are compatible but are not recommended persistent microservice identities.

## A configured output is rejected

Every Target needs an independent output root. Equal roots and parent/child combinations such as `src/api/generated` plus `src/api/generated/order` are rejected even if only one Target was requested. Also reject the Workspace root, absolute/drive/UNC paths, traversal, symlinks, `.git`, `node_modules`, and `.openapi-to` selection/transaction/lock state.

`base: 'workspace'` still means generator-managed. Put hand-written code in a separate path such as `src/api/custom`. Changing a Target from the default managed output to workspace output does not migrate or remove the old `.openapi-to` directory; verify the new result and clean the old directory manually.

## A plan is expired, stale, or already used

Create a new Prepare plan and review it again. Tokens are short-lived, one-time, process-bound, and plan-bound. Apply rejects changed input/config/reference/output/ownership/artifact state rather than silently adopting it.

## A lock or recovery diagnostic appears

CLI generation and MCP Apply share the output lock. Wait for the active writer or investigate the named stale/recovery state. Do not delete locks, journals, staging, or backups blindly; follow the [recovery guide](./mcp-write-recovery.md).

## Doctor and Inspector

From a repository checkout after `pnpm build`:

```sh
pnpm mcp:check
pnpm --silent mcp:check -- --json
pnpm mcp:inspect
```

Doctor and Inspector are repository-only and intentionally absent from the npm tarball. Installed-package users should run `openapi-to-mcp --help` and use their Host's Tool-list/status UI. Inspector is interactive and should not run in CI.
