# Getting started

`openapi-to` is the single recommended installation entrypoint:

- It installs the `openapi` and `openapi-to` CLI aliases.
- It exports Core plus all official generator plugins.
- It installs the `openapi-to-mcp` stdio server command.

Repository development and test commands require Node.js 22.13 or newer.
Published packages support Node.js 22 or newer. This repository is pinned to
pnpm 11.26.0; pnpm 12 is intentionally held as a separate major migration.

## CLI

Install the aggregate package:

```sh
pnpm add -D openapi-to
```

The installed npm package also contains version-matched
`openapi-to-setup` and `openapi-to-generate` assets. Codex users can preview
and explicitly install them without a network request:

```sh
pnpm exec openapi skills install \
  --host codex \
  --dry-run

pnpm exec openapi skills install \
  --host codex
```

The only supported installer Host is `codex`. It writes to
`$CODEX_HOME/skills`, or `~/.codex/skills` when `CODEX_HOME` is unset, and
refuses to overwrite either existing Skill directory. Restart Codex after
installation. Installing `openapi-to` does not install Skills automatically,
and `openapi init` continues to initialize only the generation config and
state ignore rule. The installer does not configure MCP; use
`openapi-to-setup` after restart for project and Host diagnosis/configuration.

The binary names are aliases:

```sh
pnpm exec openapi --help
pnpm exec openapi-to --version
pnpm exec openapi validate ./openapi.yaml
pnpm exec openapi inspect ./openapi.yaml --json
pnpm exec openapi diff ./old.yaml ./new.yaml --json
pnpm exec openapi generate --dry-run --json
```

Run `pnpm exec openapi init` to create a starting configuration in the Workspace root. Generation searches upward for the nearest `openapi.config.ts`, `.js`, `.cjs`, or `.mjs`; multiple supported files in one candidate directory fail before any configuration code executes. `--config <path>` explicitly selects one file and bypasses discovery. Validation, inspection, and diff do not require a generation config. `init` adds `/.openapi-to/` to `.gitignore`, while the root configuration remains trackable.

The selected configuration's directory becomes the generation Workspace.
Running `generate` from a nested package therefore keeps relative inputs,
managed state, and Workspace outputs anchored to the configuration directory.

For microservices, give each OpenAPI document a stable Target name and independent output root. `pnpm exec openapi generate` generates all Targets; repeat `--target <name>` to select one or more. Local JSON/YAML/YML and policy-constrained HTTP(S) inputs use the same Core loader. Managed output remains below `.openapi-to` by default, while `output.base: 'workspace'` places generator-managed code directly below the project root.

Workspace-local absolute Windows input paths are supported. Drive-relative paths (`C:openapi.yaml`), UNC paths, and configured `file:` URLs are rejected. Output segments must also be portable across Linux, macOS, and Windows; Windows device names, reserved characters, control characters, and trailing periods/spaces are rejected before generation.

See the [CLI generation guide](./cli.md) for a complete multi-document example and ownership rules, and the [capability matrix](./capability-matrix.md) before choosing a plugin or dialect.

## MCP server

The same aggregate installation provides the MCP command; no additional MCP package installation is required:

```sh
pnpm exec -- openapi-to-mcp --help
```

Advanced users who intentionally want only the MCP package boundary may instead install `pnpm add -D @openapi-to/mcp`; it provides the same standalone `openapi-to-mcp` command plus the `@openapi-to/mcp` and `@openapi-to/mcp/cli` programming interfaces.

The Phase 1 `openapi-to-generate` consumer Skill is designed primarily for business projects
that install the aggregate `openapi-to` package. It does not automatically
treat an MCP-only installation as a complete business code-generation
environment; broader MCP-only consumer support is a separate design boundary.

The safe default is local stdio and no writes:

```sh
pnpm exec -- openapi-to-mcp --workspace-root .
```

A trusted project config adds read-only catalog and generation preview/check Tools:

```sh
pnpm exec -- openapi-to-mcp --workspace-root . --config ./openapi.config.ts
```

`--allow-write` additionally exposes the existing Prepare/Apply Tools. It does not bypass Host approval:

```sh
pnpm exec -- openapi-to-mcp --workspace-root . --config ./openapi.config.ts --allow-write
```

Choose the Host-specific configuration:

- [Codex](./codex-mcp.md)
- [Claude Code](./ai-hosts/claude-code.md)
- [Cursor](./ai-hosts/cursor.md)
- [Generic stdio Host](./ai-hosts/generic-stdio.md)

All Hosts share the same [security boundary](./mcp-security.md) and [troubleshooting guide](./troubleshooting.md).

The Phase 2 [`openapi-to-setup` consumer Skill](./setup-skill.md) can
diagnose and configure an aggregate-package project and Codex MCP. It defaults
to read-only, uses the existing `openapi init`, does not upgrade an existing
version, and requires exact Setup Plan approval before package, init, ignore,
or Host writes. Automatic package mutation is pnpm-only; npm, Yarn, and Bun are
diagnostic/manual in this phase. A Codex config write returns
`RESTART_REQUIRED` until restart and actual Tool/inputSchema verification.
Phase 2.1 adds state-hash binding and Phase 2.2 adds Windows portable verified
reads; these are Setup hardening, not separate Skills. Despite the historical
phase numbering, consumers run Setup before Generate.

After setup, a compatible AI Host can use the Phase 1
[`openapi-to-generate` consumer Skill](./skills.md) to discover
Operations, preview operation-scoped output, preserve the Prepare/Apply
approval boundary, and integrate generated code. The Skill orchestrates MCP;
it does not replace the Server or perform initial package, generation-config,
or Host setup. It checks both the consuming project's actual Tool list and each
relevant Tool inputSchema because identical Tool names can expose different
argument capabilities across local versions. Selective Dry Run requires one
exact Target; unsupported selection never falls back to full-target
generation, and `replace` is used only when the current Schema explicitly
supports it.

Target `input.remote` is trusted access configuration; MCP startup remote options are operator-owned upper bounds. The effective policy uses only permissions allowed by both layers. Configured headers remain available for the initial request and same-Origin redirects, are removed on cross-Origin redirects, and are never accepted as Tool arguments. HTTPS-to-HTTP redirects are blocked.

## Repository development

Repository maintainers can install and build a source checkout before launching the source bin. This is a development/debugging workflow, not the recommended user installation:

```sh
pnpm install
pnpm build
node packages/mcp/bin/openapi-to-mcp.js --workspace-root .
```

Repository-only health and Inspector launchers are not published in the npm package:

```sh
pnpm mcp:check
pnpm --silent mcp:check -- --json
pnpm mcp:inspect
pnpm mcp:inspect -- --allow-write
```

Inspector is a foreground, authenticated localhost manual-review surface. It is not a CI gate and does not replace the automated stdio, controlled-write, recovery, or performance tests.
