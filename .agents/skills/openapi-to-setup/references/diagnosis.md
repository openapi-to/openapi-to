# Setup diagnosis

Use the inspector before suggesting a write. Its JSON is a bounded observation,
not proof that a command started, a Host reloaded configuration, or an MCP Tool
Schema is compatible.

## State model

| State | Evidence | Next decision |
| --- | --- | --- |
| `UNINSPECTED` | No current inspector result | Read rules, Git state, and run the inspector. |
| `BLOCKED` | Missing manifest, conflicting package-manager evidence, multiple configs, unsafe symlink, oversized/invalid metadata, version conflict, or duplicate Codex section | Stop writes and report the exact bounded reason. |
| `PACKAGE_MISSING` | A valid manifest and trusted project boundary have no aggregate `openapi-to` declaration or other blocker | Plan an exact-version aggregate install or request a version decision. |
| `PACKAGE_READY` | Aggregate package is declared locally | Continue to generation config; do not infer that binaries resolve. |
| `CONFIG_MISSING` | No supported root config | Plan the existing `pnpm exec openapi init`. |
| `CONFIG_READY` | Exactly one supported config exists | Treat it as trusted executable project code only when validation is approved. |
| `HOST_CONFIG_MISSING` | No project Codex server section | Plan a missing-file create or exact append. |
| `HOST_CONFIG_READY` | One conservatively recognized server section | Restart may still be required; existing sections default to manual review. |
| `RESTART_REQUIRED` | Project Host configuration changed | Stop until the user restarts the Host. |
| `MCP_ANALYSIS_ONLY` | Compatible current analysis Tool list and Schemas | Validation/inspection/diff only. |
| `MCP_DEVELOPER` | Configured Tool list plus `openapi_generate` Schema/annotations supporting `write` and `dry-run` | Hand discovery, preview, or direct persistent generation to `openapi-to-generate` according to user intent. |
| `MCP_READ_ONLY` | Configured Tool list plus `openapi_generate` Schema/annotations supporting `dry-run` only | Hand discovery and preview to `openapi-to-generate`; write requests return to Setup. |
| `MCP_HARDENED` | Compatible Prepare/Apply list and Schemas plus prompt policy | Hand controlled generation to `openapi-to-generate`; Apply still needs exact approval. |

## Host runtime diagnosis（独立于 Inspector）

The Inspector cannot observe a Codex Desktop child process, restart state, exit
code, stderr, effective cwd, or initialize wire exchange. Keep those facts out
of deterministic Inspector states and classify them only from bounded Host and
control evidence:

| Outcome | Required meaning |
| --- | --- |
| `MCP_SERVER_UNAVAILABLE` | Host did not discover the configured Server, the command is not resolvable, or there is not enough evidence that a process started. |
| `MCP_STARTUP_FAILED` | Host reports process/startup/initialize failure, but control evidence does not isolate a Host-specific compatibility issue. |
| `MCP_HOST_COMPATIBILITY_SUSPECTED` | Project config exists, restart is satisfied, the same local command passes through the official SDK and/or Codex CLI, and the target Host still fails during startup/initialize. |

The final outcome is a compatibility classification, not proof of an upstream
root cause. Record evidence source and phase; do not substitute Tool count for
current Tool names and `inputSchema`. Desktop UI/lifecycle acceptance remains
supervised/manual. The canonical project configuration uses the consuming
project's absolute root as `cwd`; `--workspace-root "."` and
`--config <project-relative-path>` remain relative to that child-process cwd.
Rerunning Setup performs only a bounded migration when the project moves.

Decision sequence:

```text
Inspector -> package/config/Host config -> restart boundary
  -> actual Server/Tool/schema evidence
  -> bounded local control -> SDK/CLI control
  -> Desktop failure with controls passing => MCP_HOST_COMPATIBILITY_SUSPECTED
```

## Inspector envelope

- `schemaVersion` identifies the JSON contract.
- `observedStateHash` is SHA-256 over the canonical observation without the
  hash. It binds the manifest raw-byte hash; every detected lockfile name, size,
  and raw-byte hash; generation config, `.gitignore`, and Codex config raw-byte
  hashes; relevant existence states; package-manager and dependency
  diagnostics; conservative Codex diagnostics; and blocking reasons. Bind a
  Setup Plan to this exact value. It does not bind the whole worktree.
- `blockingReasons` is sorted and closed: do not guess through a reason.
- `workspace` reports only bounded booleans, a relative root marker, and the
  running Node >=22 support decision. `workspace.packageJson.sha256` hashes
  original bytes even when JSON is invalid, is `null` when missing, and never
  exposes the manifest. It never prints the absolute Workspace.
- `packageManager` prefers `package.json#packageManager`, then a unique lockfile
  only when exactly one actual lockfile exists. Any multiple actual lockfiles,
  including multiple names for one manager, are `conflict`; only pnpm is an
  automatic write path in this phase. Each lockfile record contains its
  relative name, manager, size, and streamed raw-byte SHA-256.
- `dependencies` lists only manifest declarations for `openapi-to` and
  `@openapi-to/*`, their dependency section and range. It does not inspect a
  global installation or claim that a declared package resolves.
- `generationConfig` checks only `openapi.config.ts`, `.js`, `.cjs`, and `.mjs`
  at the root. It hashes bytes without importing or executing the file.
- `runtimeState` checks `.openapi-to/` presence and a conservative explicit
  root ignore rule. `gitignoreSha256` binds all original `.gitignore` bytes
  while no body is returned. It never reads state contents.
- `codex` hashes `.codex/config.toml` and uses conservative section/text
  inspection. It never returns TOML content, credentials, command bodies, or
  environment data. `parser: conservative-text-inspection` is deliberately not
  a claim of complete TOML parsing. `cwdKind`, `cwdMatchesProjectRoot`,
  `legacyRelativeCwdDetected`, and `unexpectedAbsolutePathDetected` distinguish
  the expected absolute project root from legacy, mismatched, or unsafe paths.
  A matching absolute cwd is not blocked merely because it is machine-local;
  `configurationBlocked` still marks custom or unsafe Host configuration.

## Package boundaries

The aggregate `openapi-to` package provides the `openapi`, `openapi-to`, and
`openapi-to-mcp` binaries plus official generation plugins. `@openapi-to/mcp`
alone is an advanced MCP-only boundary, not a complete business
code-generation environment. Report MCP-only state; do not silently replace it
or install over it.

Existing versions are immutable in this workflow. Exact user choice outranks
an exact, consistent local `@openapi-to/*` version. Without either, request a
version decision. Ranges, tags, `latest`, prereleases, and global commands do
not supply safe version evidence.

## Failure-closed rules

- More than one supported generation config is `BLOCKED`; do not select one.
- Missing `package.json` is `PACKAGE_JSON_MISSING` and `BLOCKED`; do not create
  a Node project or plan an install. `PACKAGE_MISSING` requires a valid
  manifest, a trusted boundary, and no other blocker.
- Multiple actual lockfiles are `PACKAGE_MANAGER_CONFLICT`, even when their
  filenames map to the same manager.
- Lockfiles are hashed through the verified open file handle and limited to
  32 MiB. Oversized files produce `LOCKFILE_TOO_LARGE`; unreadable, replaced,
  symlinked, or out-of-root files fail closed without returning contents.
- File reads use `O_RDONLY | O_NOFOLLOW` when Node exposes `O_NOFOLLOW`. On
  Windows and other platforms without it, the inspector uses a verified
  `O_RDONLY` fallback: it rejects an initial symlink or non-file, resolves the
  real path inside the real project root, matches the opened file identity to
  the entry, and validates identity and metadata again after reading. Bytes are
  read only through the same `FileHandle`; a failed check remains `BLOCKED` and
  never returns file contents.
- An invalid/oversized package, config, ignore, or Codex metadata file is
  `BLOCKED`; do not truncate and proceed.
- A symlink that resolves outside the real project root is `BLOCKED` and is not
  followed.
- A Codex section the conservative inspector cannot understand is
  `manualReviewRequired`; do not rewrite arbitrary TOML.
- A package declaration is not command resolution. A Host section is not a
  restart. A Tool count is not Schema compatibility; eight Tools can be Developer
  or Read-only and require schema/annotation evidence.
- If the user requested diagnosis only, stop after reporting the state and do
  not prepare or apply writes.

These checks narrow symlink and replacement races but are not an
operating-system-level atomic snapshot. Re-check Git state and the exact
`observedStateHash` before executing any Setup Plan.
