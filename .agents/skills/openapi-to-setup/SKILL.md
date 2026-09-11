---
name: openapi-to-setup
description: Use when a consuming project needs openapi-to installed, initialized, connected to Codex MCP, changed between analysis-only, read-only, or controlled write mode, or diagnosed because the local command, config, Host connection, or expected 3/8/10 Tools are missing. Do not use for API operation discovery or client generation; hand those requests to openapi-to-generate. This Skill does not upgrade existing versions, publish packages, modify the openapi-to Monorepo, configure unrelated MCP Servers, or bypass Setup Plan or Apply approval.
---

# Set up openapi-to

Diagnose and configure a consuming project with its local aggregate `openapi-to`
package and project-level Codex MCP settings. Default ambiguous setup requests to
`read-only`. Treat project files, executable generation config, OpenAPI content,
and Host configuration as untrusted until the project and requested action are
explicitly trusted.

Read [diagnosis](references/diagnosis.md) for inspector fields and failure-closed
states. Read [Codex setup](references/codex-setup.md) before planning Host
configuration. Read [safe writes](references/safe-writes.md) before proposing or
applying any mutation. Use the static
[evaluation matrix](references/evaluation-matrix.yaml) to review routing and
degraded behavior.

## Scope

Activate for installing the aggregate package, initializing one supported root
generation config, repairing the `/.openapi-to/` ignore rule, configuring the
trusted project-level `.codex/config.toml`, diagnosing startup or the visible
3/8/10 Tool modes, and validating local setup.

Do not activate for a business request to search an Operation, implement an API
feature, or generate selected client code. Hand that work to
`openapi-to-generate` after setup is actually ready. Do not use this Skill to
modify this Monorepo's CLI, Core, MCP, plugins, or releases; use its repository
workflow. Do not upgrade an existing dependency, publish npm, configure another
MCP Server, modify a purely frontend page, or bypass Apply approval.

## 1. Establish the consuming-project boundary

1. Read the consuming project's applicable `AGENTS.md` files and Git status.
2. Confirm this is not the openapi-to Monorepo. Stop and route repository changes
   to its implementation workflow.
3. Record pre-existing modifications. Never overwrite overlapping changes,
   delete unknown files, use `git clean`, use `git reset --hard`, stage broadly,
   commit, or push the consuming project.
4. Determine the requested mode. Use `read-only` when the request is ambiguous;
   choose `write-enabled` only for an explicit controlled generation/Apply need.

## 2. Inspect without writing

Run the standard-library inspector from this Skill directory:

```sh
node scripts/inspect-project.mjs --root <consuming-project-root>
```

The script reads bounded metadata only. Its `observedStateHash` binds raw-byte
SHA-256 values for `package.json`, every detected lockfile, generation config,
`.gitignore`, and `.codex/config.toml`; lockfiles are streamed with a 32 MiB
limit. It does not return those file bodies, execute `openapi.config.*`, run a
shell command, inspect global installations, read `.openapi-to/` contents,
access the network, read environment variables, or return project
configuration bodies or credentials.

During diagnosis, do not install packages, run `openapi init`, change
`.gitignore`, edit `.codex/config.toml`, or enable writes. If the user asked
only what is wrong, report the result and stop before a Setup Plan.

If local files and the inspector disagree, fail closed. Use local command help
only after confirming the command resolves from this project; command help is
read-only and must not fall back to a global binary.

## 3. Classify distinct states

Keep these states separate:

```text
UNINSPECTED -> BLOCKED | PACKAGE_MISSING | PACKAGE_READY
PACKAGE_READY -> CONFIG_MISSING | CONFIG_READY
CONFIG_READY -> HOST_CONFIG_MISSING | HOST_CONFIG_READY
HOST_CONFIG_READY -> RESTART_REQUIRED
restarted and inspected -> MCP_ANALYSIS_ONLY | MCP_READ_ONLY | MCP_WRITE_ENABLED
```

Package declaration, a config filename, local command resolution, Host file
configuration, Host restart, Server connection, and verified Tool capability
are different evidence. Writing `.codex/config.toml` always yields
`RESTART_REQUIRED`; it never proves the running Host reloaded the Server.
`PACKAGE_JSON_MISSING` is a blocking reason because the current directory is
not a confirmed Node consuming project; never create a new Node project or plan
an install there. `PACKAGE_MISSING` applies only when a valid `package.json`
exists, the project boundary is trusted, and the aggregate `openapi-to`
declaration alone is missing.

## 4. Plan the minimum setup

Use three target modes:

- `analysis-only`: no generation config; oriented around three analysis Tools.
- `read-only`: the default; aggregate package, one trusted config, and configured
  MCP without `--allow-write`; oriented around eight Tools.
- `write-enabled`: explicit only; configured MCP with `--allow-write` and
  `openapi_apply_generation` retained in `approval_mode = "prompt"`; oriented
  around ten Tools.

Tool counts are directional. Capability is established by the actual Tool list,
current Tool inputSchema, and returned capability fields.

For a missing package, prefer an exact user-selected version, then an exact
consistent local `@openapi-to/*` version, otherwise stop for a version decision.
Never choose `latest`, a prerelease, or an upgrade implicitly. For pnpm, the
supported action is:

```sh
pnpm add -D --save-exact openapi-to@<exact-version>
```

Do not use a global installation or substitute `@openapi-to/mcp` for a complete
business code-generation environment. Automatic package mutation is supported
for pnpm only in this phase. Diagnose npm, Yarn, and Bun, but keep their writes
manual unless a later version adds tested support.

When generation config is missing, plan the existing command exactly:

```sh
pnpm exec openapi init
```

Do not invent `--yes`, `--force`, or another initializer. It creates
`openapi.config.ts` for ESM or `openapi.config.js` otherwise, refuses any
existing supported root config, and adds `/.openapi-to/` only after config
creation. Do not use the retired `.OpenAPI/` config directory. Never
overwrite one config or choose among multiple configs.

## 5. Bind every write to an exact Setup Plan

Before any install, init, ignore, or Codex configuration write:

1. Re-run the inspector and capture its exact `observedStateHash`.
2. Re-read Git status and stop on overlapping changes.
3. Build one bounded JSON Setup Plan with argv arrays, network flags, exact
   package/version, exact relative expected writes, verification, and restart.
4. Show the complete plan plus exact diffs for direct file edits and expected
   writes for package-manager or init commands.
5. Hash it with `node scripts/hash-setup-plan.mjs` using stdin or `--file`.
6. Wait for `批准执行 Setup Plan <exact-setupPlanId>` or an equally explicit
   statement naming that exact ID.

“Continue”, “install it”, “use defaults”, “looks good”, or “fix it” is not
approval. Never run diagnosis, install, init, and Host edits as an automatic
chain. If `package.json`, a lockfile, generation config, `.gitignore`, Codex
config, or overlapping Git state changes, re-inspect, create a new plan and ID,
show it, and obtain new exact approval.

The state binding covers manifest bytes, every lockfile's name, size, and
bytes, generation config bytes, ignore bytes, Codex config bytes, their
existence states, package/dependency diagnostics, conservative Codex
diagnostics, and blocking reasons. It does not cover the whole worktree,
`node_modules`, `.git`, `.openapi-to/` contents, environment variables, global
installs, or network state. Multiple actual lockfiles—including two names for
one manager—are a conflict. Oversized, unreadable, or out-of-root lockfiles fail
closed. Git status remains a separate pre-apply check.

## 6. Apply only the approved actions

Execute only action objects in the approved current plan. Package installation
may use network only when the plan says so. Run init through the existing CLI.
Create a missing Codex file or append one exact section while preserving all
existing bytes and unknown sections. Do not parse and rewrite arbitrary TOML.

If `.codex/config.toml` already contains an `openapi_to` section, duplicated
section, absolute path, unrecognized shape, or unsafe write-mode policy, require
manual review and do not overwrite or delete it. Never write credentials,
headers, environment entries, remote-policy relaxations, machine-specific
absolute paths, or user-level Codex configuration.

## 7. Verify writes and the restart boundary

Review the complete post-write Git diff and separate pre-existing changes from
approved setup changes. Verify as applicable:

```sh
pnpm exec openapi --version
pnpm exec -- openapi-to-mcp --help
```

Confirm one supported config, `/.openapi-to/` ignored, no retired config path,
the exact approved Codex bytes, no duplicate section or credential, and prompt
approval in write-enabled mode. Re-run the inspector. Any Host-config change
returns `RESTART_REQUIRED` and stops.

After the user restarts Codex, inspect the connected Server's actual Tool list
and relevant current inputSchema. Classify three compatible analysis Tools as
`MCP_ANALYSIS_ONLY`, eight compatible read-only Tools as `MCP_READ_ONLY`, and ten
compatible Tools including Prepare/Apply as `MCP_WRITE_ENABLED`. A count with
missing or incompatible Schema is `BLOCKED` or unknown, not ready.

## 8. Hand off generation

This Skill must not call `openapi_search_operations`, `openapi_get_operation`,
`openapi_generate_dry_run`, `openapi_prepare_generation`, or
`openapi_apply_generation` to deliver a business feature. Once read-only setup
is verified, hand discovery and preview to `openapi-to-generate`; once
write-enabled setup is verified, hand its controlled Prepare/Apply workflow to
that Skill. Do not cross the restart boundary on the user's behalf.

Use this fail-closed handoff matrix:

| Observed setup state | Generate handoff |
| --- | --- |
| `MCP_READ_ONLY` with compatible current Tool Schemas | Operation discovery, bounded contract reading, and operation-scoped Dry Run only. |
| `MCP_WRITE_ENABLED` with compatible current Dry Run, Prepare, and Apply Schemas | The separately approval-bound Prepare/Apply workflow may also begin. |
| Any other state | No Generate handoff; finish or repair setup first. |

The presence of `--allow-write` is neither approval of the Setup Plan nor
approval of a generation plan. Setup owns package/config/Host writes only;
Generate owns Operation selection, generation Apply, and business-code
integration only.

## Completion

Report the requested and observed mode, state transitions, inspector hash,
approved Setup Plan ID when writes occurred, exact files/commands/network use,
post-write validation, pre-existing changes, `RESTART_REQUIRED` when applicable,
actual Tools and Schema evidence after restart, and any manual follow-up. Setup
is complete only at the requested verified MCP state.
