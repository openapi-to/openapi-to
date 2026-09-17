# Consumer Agent Skills（消费项目 Agent Skills）

Agent Skills do not replace openapi-to MCP。Agent Skills 不替代 openapi-to MCP。MCP Server 提供 deterministic、schema-bounded 的 discovery、
generation preview 和 controlled Prepare/Apply capability；Skill 则提供 AI Host 使用的调用顺序、
scope 选择、approval boundary、business-code integration steps 和 failure handling。

## 两个 consumer phases

编号记录 delivery history：Phase 1 是 `openapi-to-generate`，Phase 2 是 `openapi-to-setup`，Phase 2.1 是 Setup state-hash hardening，Phase 2.2 是 Setup 的 Windows portable verified-read hardening。Phase 2.1 和 Phase 2.2 不新增 consumer Skill。实际用户路径相反：先 setup 并验证 Host，再把 business request 交给 generate。

repository 分发两个 specialized consuming-project workflows：

- [`openapi-to-setup`](../.agents/skills/openapi-to-setup/SKILL.md) 诊断 package、config、ignore、local command、Codex project configuration、restart 和 actual Tool capability。模糊 setup request 默认 read-only，每次 write 都要求 exact Setup Plan approval。

- [`openapi-to-generate`](../.agents/skills/openapi-to-generate/SKILL.md) 查找 business feature 所需的 API Operations，读取 bounded contracts，优先 operation-scoped generation，准备 exact write plan，等待 current `planHash` approval，Apply 该 plan，并将 generated code 集成到 consuming project。

“configure openapi-to in this project”、“why are only three Tools visible?”和“enable controlled writes”使用 setup；“add user deletion from the API documentation”、“find the order export endpoint and generate its request code”以及“implement this page's API call with openapi-to”使用 generate。pure frontend work，以及修改本 Monorepo 的 MCP、CLI、Core、plugins 或 release process，不应使用 consumer Skill。

repository 在 `.agents/skills/` 下为每个 Skill 保留一个 authoritative source。
The npm build derives versioned distribution assets from those directories;
there is no second maintained source tree. Interface metadata lives beside
each Skill in `agents/openai.yaml`. The canonical GitHub directories remain:

```text
https://github.com/Vc-great/openapi-to/tree/main/.agents/skills/openapi-to-generate
https://github.com/Vc-great/openapi-to/tree/main/.agents/skills/openapi-to-setup
```

安装 aggregate npm package 后，Codex users 可以 preview 并显式安装该 exact package 携带的两个 assets：

```sh
pnpm exec openapi skills install \
  --host codex \
  --scope project \
  --dry-run

pnpm exec openapi skills install \
  --host codex \
  --scope project

pnpm exec openapi skills install \
  --host codex \
  --scope user
```

此 command 离线运行，目前只支持 Codex。它验证
package version, manifest, and every packaged file before writing the exact
scope destination. `project` means only the command's current project/subtree:
`$CWD/.agents/skills`; `user` means the current user's projects:
`$HOME/.agents/skills`. Scope is required; there is no implicit default.
`~/.codex/skills` is a historical legacy location: it may produce a bounded
warning, but is never migrated, moved, deleted, overwritten, or merged.
If either target already exists, the command fails before writing. Restart
Codex after installation. 本阶段没有 update、uninstall、force、Claude Code、Cursor 或 generic Host installer。

npm install 与 `openapi init` 保持不变，绝不隐式安装 Skills。`openapi init` 仍只负责 generation-config initialization 和 state ignore rule。Skill installer 不配置 MCP。Restart Codex 后调用 `openapi-to-setup`，由其独立 Setup Plan 诊断或配置 consuming project 与 Codex Host。

## Consumer prerequisites（前置条件）

在 consuming Workspace 安装 aggregate package：

```sh
pnpm add -D openapi-to
```

Skill 必须使用 consuming project's local version。不得 silently fall back to a global installation，普通用户也不需要单独的 `@openapi-to/mcp` installation。通过以下命令启动 local stdio Server：

```sh
pnpm exec -- openapi-to-mcp
```

将 generation config 保存在 Workspace root 的 `openapi.config.ts`；该位置必须与 openapi-to runtime state directory `.openapi-to/` 区分。

`@openapi-to/mcp` 仍是 advanced MCP-only package boundary。consumer Skill MVP 面向使用 aggregate `openapi-to` package 的 business project，不得假设 MCP-only installation 是完整 code-generation environment；更广泛的 MCP-only consumer support 需要独立设计。

执行任何 workflow 前，Skill 检查 MCP Tools 实际
exposed to the Host and each relevant current Tool inputSchema. The expected
capability matrix is three analysis Tools without config, eight read-only Tools
with config, and ten Tools with config plus `--allow-write`, but counts are only
orientation. The actual Tool list, Tool inputSchema, and capability fields
returned by current calls take precedence over the consuming project's local
package version, which takes precedence over current or historical
documentation. A matching Tool name does not prove that its newer inputSchema
capabilities exist.

Generate 的首次发现必须遵守一个 MCP-first gate：Setup state 与 actual
Tool/schema capability 先验证；Target 不明确时先 `openapi_list_targets`，再
`openapi_search_operations`、`openapi_get_operation`，最后使用 exact Target 和
operation key 做 operation-scoped Dry Run。允许读取 consuming call sites、附近
business code 和 generation config 等有界上下文，但不得先 broad/full-scan OpenAPI
并把 MCP 仅当确认器。Completion 必须保留 Tool 实际返回的 selection、projection、
artifact、diagnostic 和 truncation evidence；只有返回的 `artifact.preview` 才是
MCP/generator preview，Agent 自己写的示意代码必须标为 illustrative example。

Operation-scoped Dry Run is available only when the current Schema supports
`targets`, `scope.type = operations`, and `scope.operationKeys`. It must use
exactly one grounded Target; in a multi-Target project, list Targets first and
never guess or rely on an omitted Target's default behavior:

```json
{
  "targets": ["<exact-target>"],
  "scope": {
    "type": "operations",
    "operationKeys": ["<exact-operation-key>"]
  }
}
```

若 selective Dry Run unsupported，Skill 保持 read-only，不退回 full-target generation。Selection `add` 需要 explicit Schema support for `selection` and operation keys；`replace` additionally requires explicit current inputSchema support for `selection.type = replace`。Host 无法 expose inputSchema 时，Skill 报告 limitation，并对 version-sensitive capabilities fail closed，不向旧 local Tool 发送 latest documentation 的 parameters。

package/project configuration 见 [getting-started guide](./getting-started.md)，trusted local Server 配置见 [Codex MCP guide](./codex-mcp.md)。write-enabled Codex example 保持 `openapi_apply_generation` in prompt approval mode。

## Phase boundary（阶段边界）

setup Skill 是 phase two：先做 read-only diagnosis，使用既有 `openapi init`，does not upgrade an existing version，且 automatic package mutation 仅支持 pnpm。每次 installation/configuration change 都需要 exact current Setup Plan ID。Codex project configuration 是 Codex-first；npm、Yarn、Bun、Claude Code、Cursor 和 generic Host writes 仍是 diagnostic/manual boundary。Host changes return `RESTART_REQUIRED`，actual Tool list 与 current Tool inputSchema 仅在 restart 后验证。见 [the setup guide](./setup-skill.md)。

generate Skill 仍是 phase one，绝不安装 dependencies 或修改 `package.json`、`openapi.config.ts`、`.codex/config.toml`。Setup 不新增 MCP Tools 或替换 MCP；requested mode 验证后，将日常 API discovery、selective generation 和 integration 交给 generate。

The handoff follows one closed rule:

| Observed setup state | Generate handoff |
| --- | --- |
| `MCP_READ_ONLY` with compatible current Tool Schemas | Operation discovery, bounded contract reading, and operation-scoped Dry Run only. |
| `MCP_WRITE_ENABLED` with compatible current Dry Run, Prepare, and Apply Schemas | The separately approval-bound Prepare/Apply workflow may also begin. |
| Any other state | No Generate handoff; finish or repair setup first. |

此 default-deny row 包括 `MCP_ANALYSIS_ONLY` 以及所有 pre-verification、blocked 或 future state。`--allow-write` is neither Setup Plan approval nor generation Apply approval。

automatic setup support 仅限 pnpm 和 trusted project-level Codex
`.codex/config.toml`. npm, Yarn, Bun, Claude Code, Cursor, and generic stdio
Hosts 可以诊断，但其 writes 仍为 manual。两个 Skill 都不会使用
global package fallback, silently upgrades openapi-to, executes an untrusted
generation config during setup diagnosis, or treats Tool count as capability
proof.

## Acceptance-test ownership（验收归属）

focused Setup Inspector Node tests 负责 setup state transitions 和 safe
inspection. `pnpm test:consumer:codegen` owns packed formal-plugin generation,
strict compile, runtime, drift, and idempotence. Its
`test:consumer:codegen:review` alias only exports a human-review snapshot after
that same test passes. `pnpm release:smoke` is the canonical full packed
consumer acceptance entry and reuses the codegen scenario plus its single
tarball set.

Release smoke 还在一个 external consumer 中运行 repository-Skill Inspector
and the packed MCP in one external consumer. It proves the inferred
read-only/write-enabled mode agrees with the actual named Prepare/Apply
capability and that Setup evidence expires on observed-state drift. It is not
a model-behavior test or a second golden path. The complete assignment is in
the [consumer acceptance coverage matrix](./testing/consumer-acceptance-matrix.md).
