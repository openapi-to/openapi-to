---
name: openapi-to-setup
description: Use when a consuming project needs openapi-to installed, initialized, connected to Codex MCP, classified as analysis-only, developer, read-only, or hardened, or diagnosed because the local command, config, Host connection, or expected 3/8/8/10 Tools are missing. Do not use for API operation discovery or client generation; hand those requests to openapi-to-generate. This Skill does not upgrade existing versions, publish packages, modify the openapi-to Monorepo, configure unrelated MCP Servers, or bypass Setup Plan or Apply approval.
---

# 设置 openapi-to

使用本地 aggregate `openapi-to` package 和 project-level Codex MCP settings 诊断、恢复、验证 consuming
project。普通首次 Codex project bootstrap 的 deterministic writer 是 CLI
`openapi setup --host codex --scope project`；本 Skill 负责 diagnosis、degraded recovery、session/Host
reload guidance 和 post-reload capability verification。普通 onboarding 生成的 configured MCP 使用
Developer default；明确更严格的 Read-only 或 Hardened 需求必须通过现有安全配置/恢复流程表达。在 project 与 requested action 明确信任前，project
files、executable generation config、OpenAPI content 和 Host configuration 都视为 untrusted。
inspector fields 和 failure-closed states 见 [diagnosis](references/diagnosis.md)；规划 Host
configuration 前读取 [Codex setup](references/codex-setup.md)，提出或 Apply mutation 前读取
[safe writes](references/safe-writes.md)，并用 static [evaluation matrix](references/evaluation-matrix.yaml)
检查 routing 与 degraded behavior。
## Mandatory first-plan gate（首次规划强制门）

For any Skill-mediated request that needs a Setup Plan, complete this ordered gate before the first plan.
Direct `openapi setup --host codex --scope project` invocation is the operator's explicit bounded
CLI execution and does not wait for a second Skill approval ceremony:

1. **Inspector first:** run `node scripts/inspect-project.mjs --root <consuming-project-root>`.
2. Treat the Inspector `state`, `blockingReasons`, package evidence, supported generation config,
   Codex evidence, and `observedStateHash` as the planning authority.
3. If the Inspector reports `BLOCKED`, stop; do not bypass it with broad filesystem guesses.
4. Preserve pre-existing `PACKAGE_READY` dependency state: do not upgrade, reinstall, replace a
   local tarball/override with a registry package, or perform reproducibility cleanup.
5. Use only Inspector-supported generation config evidence; never choose `mcp.config.ts`, an
   arbitrary `*.config.ts`, a fixture, or a test file.
6. Automatic Host mutation is limited to the trusted consuming project's `.codex/config.toml`.
7. Use canonical `[mcp_servers.openapi_to]` with the consuming project's absolute
   root as `cwd`; keep `--workspace-root "."` and the discovered generation-config
   path relative to that cwd.
8. Construct the complete bounded JSON Setup Plan, then actually run
   `node scripts/hash-setup-plan.mjs` to produce the exact lowercase 64-character SHA-256 ID.
9. Display the complete plan and exact SHA-256 `setupPlanId`; wait for exact approval naming that
   current ID before any write.
10. Host config writes end at `RESTART_REQUIRED`; stop without checking the current session. Start a fresh Codex chat/session and inspect actual Tools, relevant inputSchema, and available runtime evidence. If stale or reload is unclear, fully restart the Codex Host.

The detailed schemas, file handling, drift checks, and capability rules remain in the referenced
`codex-setup.md` and `safe-writes.md` documents.
## Scope（范围）

用于安装 aggregate package、初始化一个 supported root generation config、修复 `/.openapi-to/` ignore rule、配置 trusted project-level `.codex/config.toml`、诊断 startup/可见的 3/8/8/10 Tool modes，以及验证 local setup。

不要因搜索 Operation、实现 API feature 或生成 selected client code 的 business request 激活。setup
真正 ready 后将其交给 `openapi-to-generate`。不得用本 Skill 修改 Monorepo 的 CLI、Core、MCP、plugins
或 releases；也不得 upgrade dependency、publish npm、配置另一个 MCP Server、修改 purely frontend
page 或绕过 Apply approval。
## 1. 建立 consuming-project boundary

1. 读取 consuming project 适用的 `AGENTS.md` files 和 Git status。
2. 确认这不是 openapi-to Monorepo；repository changes 应停止并转到其 implementation workflow。
3. 记录 pre-existing modifications。Never overwrite overlapping changes、delete unknown files、使用 `git clean`/`git reset --hard`、broad stage、commit 或 push consuming project。
4. 确定 requested mode。普通 onboarding 选择 `developer`；明确只读需求选择 `read-only`，只有明确的受控审批写入需求才选择 `hardened`。不要静默选择 Hardened。
## 2. 无写入检查

Run the standard-library inspector from this Skill directory:

```sh
node scripts/inspect-project.mjs --root <consuming-project-root>
```

脚本只读取 bounded metadata。其 `observedStateHash` 绑定 raw-byte
SHA-256 values for `package.json`, every detected lockfile, generation config,
`.gitignore`, and `.codex/config.toml`; lockfiles are streamed with a 32 MiB
limit. It does not return those file bodies, execute `openapi.config.*`, run a
shell command, inspect global installations, read `.openapi-to/` contents,
access the network, read environment variables, or return project
configuration bodies or credentials.

诊断期间不要 install packages、run `openapi init`、change
`.gitignore`, edit `.codex/config.toml`, or enable writes. If the user asked
only what is wrong, report the result and stop before a Setup Plan.

If local files and the inspector disagree, fail closed. Use local command help
only after confirming the command resolves from this project; command help is
read-only and must not fall back to a global binary.
## 3. 区分 distinct states

Keep these states separate:

```text
UNINSPECTED -> BLOCKED | PACKAGE_MISSING | PACKAGE_READY
PACKAGE_READY -> CONFIG_MISSING | CONFIG_READY
CONFIG_READY -> HOST_CONFIG_MISSING | HOST_CONFIG_READY
HOST_CONFIG_READY -> RESTART_REQUIRED
fresh session (or required Host restart) and inspected -> MCP_ANALYSIS_ONLY | MCP_DEVELOPER | MCP_READ_ONLY | MCP_HARDENED
```

Package declaration、config filename、local command resolution、Host file
configuration, a fresh runtime/session boundary, Server connection, and verified Tool capability
are different evidence. Writing `.codex/config.toml` always yields
`RESTART_REQUIRED`; it never proves the current session reloaded the Server.
`PACKAGE_JSON_MISSING` is a blocking reason because the current directory is
not a confirmed Node consuming project; never create a new Node project or plan
an install there. `PACKAGE_MISSING` applies only when a valid `package.json`
exists, the project boundary is trusted, and the aggregate `openapi-to`
declaration alone is missing.

Host runtime diagnosis is a separate layer after `HOST_CONFIG_READY` or restart:
`MCP_SERVER_UNAVAILABLE`, `MCP_STARTUP_FAILED`, and
`MCP_HOST_COMPATIBILITY_SUSPECTED`. The last outcome requires a restarted
Host plus the same local command passing through the official SDK or Codex CLI
while the target Host fails during startup/initialize; missing Tools alone is
not proof of an upstream bug. Keep the Inspector deterministic and label
Desktop acceptance as supervised/manual. Setup writes the consuming project's
absolute root as canonical `cwd`; `--workspace-root "."` and
`--config <project-relative-path>` remain relative to that child-process cwd.
Rerun Setup after a move, clone, or worktree path change to migrate its exact
canonical section.

## 4. 规划最小 setup

Use four target modes:

- `analysis-only`: no generation config; only three analysis Tools.
- `developer`: the ordinary configured default; omit `--generation-mode` and expose eight Tools, with `openapi_generate` supporting persistent write or `dry-run`.
- `read-only`: explicit configured mode with eight Tools; `openapi_generate` is `dry-run` only.
- `hardened`: explicit configured mode with ten Tools; `openapi_generate` is `dry-run` only and Prepare/Apply is the sole persistent path.

Tool counts 仅作方向性参考。Capability 必须由 actual Tool list、current Tool inputSchema 和可获得的 runtime capability evidence 建立；若 Host 未显示 annotations，应标明 annotation evidence unavailable，不能编造或仅因此判 Setup 失败。

Developer and Read-only both expose eight Tools; `openapi_generate` inputSchema distinguishes them (`write` + `dry-run` versus `dry-run` only). Use visible annotations as corroborating evidence; otherwise report annotation evidence unavailable and rely on actual Tools, schema, descriptions, and bounded runtime evidence.
Hardened additionally requires the exact Prepare/approval/Apply contract.

For a missing package, prefer an exact user-selected version, then an exact
consistent local `@openapi-to/*` version, otherwise stop for a version decision.
Never choose `latest`、prerelease 或隐式 upgrade。This Skill does not upgrade existing versions。For pnpm，支持的
supported action is:

```sh
pnpm add -D --save-exact openapi-to@<exact-version>
```

Do not use a global installation，也不要用 `@openapi-to/mcp` 替代完整的
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

## 5. 将 Skill-mediated 写入绑定到 exact Setup Plan

任何 install、init、ignore 或 Codex configuration write 前：

1. Re-run the inspector and capture its exact `observedStateHash`.
2. Re-read Git status and stop on overlapping changes.
3. Build one bounded JSON Setup Plan with argv arrays, network flags, exact
   package/version, exact relative expected writes, verification, and restart.
4. Show the complete plan plus exact diffs for direct file edits and expected
   writes for package-manager or init commands.
5. Hash it with `node scripts/hash-setup-plan.mjs` using stdin or `--file`.
6. Wait for `批准执行 Setup Plan <exact-setupPlanId>` or an equally explicit
   statement naming that exact ID.

“Continue”、“install it”、“use defaults”、“looks good”或“fix it”不是 approval。Never run diagnosis、install、init 和 Host edits as an automatic
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

## 6. 只 Apply approved actions

Execute only action objects in the approved current plan. Package installation
may use network only when the plan says so. Run init through the existing CLI.
Create a missing Codex file or append one exact section while preserving all
existing bytes and unknown sections. Do not parse and rewrite arbitrary TOML.

If `.codex/config.toml` already contains an exact legacy `cwd = "."` section or an
exact canonical section with a stale absolute root, migrate only that section.
Duplicated/custom/unsafe sections, unexpected absolute paths, unrecognized shape,
or unsafe write-mode policy require manual review and do not overwrite or delete
it. Never write credentials, headers, environment entries, remote-policy
relaxations, or user-level Codex configuration.

## 7. 验证写入与 fresh-session / Host reload boundary

Review the complete post-write Git diff and separate pre-existing changes from
approved setup changes. Verify as applicable:

```sh
pnpm exec openapi --version
pnpm exec -- openapi-to-mcp --help
```

Confirm one supported config, `/.openapi-to/` ignored, no retired config path,
the exact approved Codex bytes, no duplicate section or credential, and
`approval_mode = "prompt"` only for Hardened mode. Re-run the inspector. Any Host-config change
returns `RESTART_REQUIRED` and stops.

After the user starts a fresh Codex chat/session, inspect actual Tools, relevant inputSchema, and
available runtime evidence. If configuration, Tools, or Skills remain stale, or the Host surface's
fresh-session behavior is uncertain, fully restart Codex and inspect again; do not assume every
Codex surface reloads identically. Classify three
compatible analysis Tools as `MCP_ANALYSIS_ONLY`; classify eight configured Tools
as `MCP_DEVELOPER` only when `openapi_generate` supports `write` and `dry-run`,
or `MCP_READ_ONLY` only when it supports `dry-run` alone; classify ten compatible
Tools with Prepare/Apply and prompt policy as `MCP_HARDENED`. A count with
missing or incompatible Schema is `BLOCKED` or unknown, not ready.

## 8. hand off generation

This Skill must not call `openapi_search_operations`, `openapi_get_operation`,
`openapi_generate`, `openapi_prepare_generation`, or
`openapi_apply_generation` to deliver a business feature. Once read-only setup
is verified, hand discovery and preview to `openapi-to-generate`; once Developer
or Hardened setup is verified, hand the matching direct-generation or controlled
Prepare/Apply workflow to that Skill. Do not cross the restart boundary on the
user's behalf.

Use this fail-closed handoff matrix:
| Observed setup state | Generate handoff |
| --- | --- |
| `MCP_DEVELOPER` with compatible `openapi_generate` Schema | Operation discovery, bounded contract reading, preview, or direct persistent generation according to user intent. |
| `MCP_READ_ONLY` with compatible current Tool Schemas | Operation discovery, bounded contract reading, and operation-scoped `openapi_generate` Dry Run only. |
| `MCP_HARDENED` with compatible current Dry Run, Prepare, and Apply Schemas | The separately approval-bound Prepare/Apply workflow may also begin. |
| Any other state | No Generate handoff; finish or repair setup first. |

Legacy `--allow-write` is rejected and is never a live setup mode. Setup owns package/config/Host writes only;
Generate owns Operation selection, generation Apply, and business-code
integration only.
## Completion（完成报告）
Report the requested and observed mode, state transitions, inspector hash,
approved Setup Plan ID when writes occurred, exact files/commands/network use,
post-write validation, pre-existing changes, `RESTART_REQUIRED` when applicable,
actual Tools and Schema evidence after a fresh session or required Host restart, and any manual follow-up. Setup
is complete only at the requested verified MCP state.
