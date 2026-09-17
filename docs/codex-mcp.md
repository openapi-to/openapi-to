# 在 Codex 中使用 openapi-to MCP

Codex 从 `config.toml` 读取 MCP Server；trusted project 可以使用 `.codex/config.toml`。Local stdio server 的 current field 包括 `command`、`args`、`env`/`env_vars`、`cwd`、`startup_timeout_sec` 和 `tool_timeout_sec`。本 project 要求 Node.js 22 或更新版本。不要提交 machine-specific absolute path。

示例遵循当前官方 [Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp)。Project config 只对 trusted project 加载。

## 安装（Install）

在 Workspace 安装 aggregate package。它包含 Core、CLI、所有 official generator 和 `openapi-to-mcp` command：

```sh
pnpm add -D openapi-to
pnpm exec -- openapi-to-mcp --help
```

大多数用户不需要单独安装 `@openapi-to/mcp`。

## Trusted-config read-only setup

在 trusted project 的 `.codex/config.toml` 中加入：

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

此 mode 暴露八个 read-only Tool：三个 no-config analysis Tool，加上 target listing、operation search、bounded operation contract reading、generation dry-run 和 generation check。省略 `--config` 可使用三个 Tool 的 analysis-only mode。

Native Windows 可以通过 `cmd.exe` 启动 package-manager shim：

```toml
[mcp_servers.openapi_to]
command = "cmd.exe"
args = ["/d", "/s", "/c", "pnpm exec -- openapi-to-mcp --workspace-root . --config openapi.config.ts"]
cwd = "."
startup_timeout_sec = 10
tool_timeout_sec = 60
```

`tool_timeout_sec` 是 Codex-side deadline。Server 还强制执行自身的 per-Tool deadline；只能在 `args` 中配置，例如 `"--validate-timeout-ms", "30000", "--generation-timeout-ms", "60000"`。Codex cancellation 会传播到 active compiler/generator call 和 queued generation。Cancellation 后 Server 仍可使用。

### Desktop startup diagnosis

如果 Desktop 显示 `starting` 后报告 `initialize response: connection closed`，先保留 canonical `cwd = "."`，确认 project config 已被重启后的 Host 读取，再分别记录 local command、official MCP SDK、Codex CLI 与 Desktop 的结果。相同 command 在 SDK/CLI 成功而 Desktop 在 initialize 失败时，只能分类为 `MCP_HOST_COMPATIBILITY_SUSPECTED`；它不是 Codex Desktop root cause 的证明。若 local control 也失败，则归为 openapi-to startup 或 compatibility unknown，不要归因于 Desktop。参见 upstream [openai/codex#45555](https://github.com/openai/codex/issues/45555)。

`openapi-to-mcp` 的 startup stderr 会提供 bounded phase/category diagnostics；它不会输出 raw error、stack、environment、credential 或 absolute project path。Desktop child 的 effective cwd、exit code、stderr 和 wire exchange 仍属于 Host-dependent unknown。将 `cwd` 改成 absolute path 只能是 manual machine-local workaround，不应提交、自动生成或替代 portable canonical configuration。参见 [troubleshooting](./troubleshooting.md)。

对于 remote Target，`input.remote` 是 trusted access requirement，而 `--allow-host` 与 `--allow-private-network` 是 Codex Server operator ceiling。两层都必须允许该 request。Tool call 不能提供 header；configured header 只在 same-Origin redirect 中保留，cross-Origin 时移除，并且绝不会通过 HTTPS-to-HTTP downgrade 发送。

## Controlled writes（受控写入）

要暴露 Prepare/Apply，Server operator 必须添加 `--allow-write`，Codex 仍必须在 Apply 前 prompt：

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

这会产生十个 Tool。Codex 应先调用 `openapi_prepare_generation`，向用户说明 added/modified/deleted summary 和 exact plan hash，然后等待。只有用户明确批准该一个未过期 plan 后，才可调用 `openapi_apply_generation`。“Generate”“update”“continue”、freshness check 或 preview request 都不是充分确认。上下文中有多个 plan 时，Codex 必须询问使用哪个 hash，绝不能猜测。Stale 或 expired rejection 需要新的 Prepare 和新的 confirmation，不能自动串联 Prepare-then-Apply。

Tool count 不能证明不同 local package version 之间的 argument compatibility。Codex 必须检查每个相关 current Tool 的 inputSchema 以及实际 Tool list。Operation-scoped Dry Run 要求 Schema 支持 operations scope，并且只能使用一个明确且有 grounding 的 Target。Selective Prepare 要求 Schema 支持 `selection`；`replace` 具有 version-sensitive 行为，只有在明确存在 `selection.type = replace` 时才允许使用。如果 Codex 无法检查 inputSchema，应报告该 gap，并对未经验证的 version-sensitive behavior fail closed。缺少 selective support 绝不能成为 full-target generation 或 dependency upgrade 的理由。

对于持久化 project intent，Codex 可以传入 `selection: { type: "add", operationKeys: [...] }`，计算 `desired = previous ∪ requested`；也可以传入非空的 `selection: { type: "replace", operationKeys: [...] }`，计算 `desired = requested`。Replace 可能移除 operation，必须 review managed deletion；空 replace 不是 clear。Codex 应比较返回的 mutation type，以及 previous/requested/new/already-selected/retained/removed/desired summary 与 count、projection count、change summary、truncation diagnostic 和 exact plan hash。Prepare 既不写 selection，也不写 generated output，但成功的 selective plan 会返回 `applySupported: true` 和 one-time token。只有明确 approval 后，Codex 才可使用返回的 plan ID、token 和 exact approved hash 调用 Apply。Apply 不能接受或推断 operation key、path、config、source、plugin、content 或 cleanup policy。对于未改变的 full Prepare/Apply workflow，省略 `selection`；remove、clear、prune、historical full-output migration 与 rename migration 仍 unsupported。

`--allow-write` 是 operator capability grant，不是 human approval 的证明。Server 以 cryptographic binding 将 Apply 绑定到 Prepare result，但最终 interaction boundary 仍依赖 Codex 与 Host Tool approval。应仔细 review managed deletion。不存在 force、dynamic target/path/content override、OpenAPI edit 或 arbitrary file write。

## Repository development mode

Maintainer 调试 source checkout 时，可以构建并启动 source bin：

```sh
pnpm install
pnpm build
node packages/mcp/bin/openapi-to-mcp.js --workspace-root .
```

这是 repository development workflow，不是推荐的 user installation。`pnpm mcp:check` 与 foreground `pnpm mcp:inspect` helper 也仅供 repository 使用，并有意不包含在 published `openapi-to` package 中。

首次 project bootstrap 可使用 `pnpm exec openapi setup --host codex --scope project`；它只写 read-only project config，改变 `.codex/config.toml` 后返回 `RESTART_REQUIRED`。修改 configuration 或 OpenAPI target 后重启 Codex。在 Codex terminal UI 中使用 `/mcp`，或在 desktop app/IDE extension 的 MCP servers settings 页面确认 Server 与 Tool。无 config 的 Server 显示三个 Tool；有 config 时显示八个；config 加 `--allow-write` 时显示十个。

See [getting started](./getting-started.md), [troubleshooting](./troubleshooting.md), and the shared [MCP security boundary](./mcp-security.md). The server is local stdio only. stdout is MCP JSON-RPC; operational logs use stderr. It does not provide HTTP, OAuth, multi-tenancy, LLM calls, or a chat UI.

trusted Server 可用后，Phase 1 的
[`openapi-to-generate` consumer Skill](./skills.md) gives Codex the bounded
Operation discovery、operation-scoped Dry Run、exact-plan approval、Apply 与 business integration sequence。它使用 consuming project 的 local openapi-to version、actual Tool list 和 current Tool inputSchema；setup automation 不属于此阶段。Phase 2 的
[`openapi-to-setup` Skill](./setup-skill.md) owns that diagnosis and
configuration boundary。它默认 read-only，使用既有 `openapi init`，不升级现有 version，写入时要求 exact Setup Plan ID，并在修改此 file 后返回 `RESTART_REQUIRED`。Restart 后，3/8/10 只作为 orientation，随后验证实际 Tool list、current Tool inputSchema 和返回的 capability field。

Phase label 是 historical：Phase 2.1 加固了 Setup state binding，Phase 2.2 增加了 Windows portable verified read。它们不是新的 Skill，操作顺序仍是先 Setup，再 Generate。

对于 maintainer，`pnpm release:smoke` 是 canonical full packed consumer acceptance entry。它的 narrow Setup-to-MCP bridge 会在 repository-external temporary consumer 中写入这些 supported project-relative Host form，将 repository-Skill Inspector 推断的 mode 与 locally packed MCP 的 named Tool 比较，检查 current Tool Schema，并在 `observedStateHash` drift 后使 handoff 失效。它既不读取用户的 `~/.codex`，也不声称 Inspector 属于 npm tarball。参见 [consumer acceptance coverage matrix](./testing/consumer-acceptance-matrix.md)。
