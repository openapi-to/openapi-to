# Codex 项目配置

本阶段的自动 Host configuration 以 Codex 为先，并且只针对可信 consuming project 的 `.codex/config.toml`。Claude Code、Cursor 和通用 stdio Hosts 继续使用现有文档，并需要手动配置 Host。

## macOS 与 Linux

Analysis-only configuration 不设置 `--config`。预期的 runtime topology 是三个兼容的 analysis Tools；但只有新的实际 Tool/schema/runtime evidence 才能确定观察到的 `MCP_ANALYSIS_ONLY` state。仅仅没有 config 不能证明该 state：

```toml
[mcp_servers.openapi_to]
command = "pnpm"
args = ["exec", "--", "openapi-to-mcp", "--workspace-root", "."]
cwd = "<ABSOLUTE_PROJECT_ROOT>"
startup_timeout_sec = 10
tool_timeout_sec = 60
```

Configured Developer 是普通 Setup 的默认值。省略 `--generation-mode`，让 MCP server 的 trusted-config default 提供 Developer capability：

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

如果发现的 config 文件名是 `.js`、`.cjs` 或 `.mjs`，必须使用该精确文件名。不要臆造或重命名 config。

Read-only 是显式的更严格 mode。用户要求只 preview、不持久化 generation 时，添加 `--generation-mode read-only`：

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

Hardened 是显式的更严格 mode。添加 `--generation-mode hardened` 并保留 Apply prompt section。Developer 的直接写入使用 `openapi_generate`；Read-only 和 Hardened 的 `openapi_generate` 只能 preview。Hardened 持久化写入必须经过精确的 Prepare/approval/Apply。旧版 `--allow-write` flag 会被拒绝，不是受支持的 configuration。

```toml
[mcp_servers.openapi_to.tools.openapi_apply_generation]
approval_mode = "prompt"
```

## 原生 Windows

使用仓库已验证的 `cmd.exe` 写法，因为 Host 可能无法直接执行 pnpm 的 `.cmd` shim。配置 section 如下：

```toml
[mcp_servers.openapi_to]
command = "cmd.exe"
args = ["/d", "/s", "/c", "pnpm exec -- openapi-to-mcp --workspace-root . --config openapi.config.ts"]
cwd = "<ABSOLUTE_PROJECT_ROOT>"
startup_timeout_sec = 10
tool_timeout_sec = 60
```

显式使用 Read-only 或 Hardened mode 时，在最终 command string 中加入对应的 `--generation-mode` 值；Hardened 还需配置 Apply prompt section。不要使用 POSIX absolute paths 或绑定某台机器的 Node paths。

## 文件处理

- 文件缺失时：只有经过明确 approval 的 plan 才能创建完整文件。
- 文件存在但没有 `openapi_to` section 时：经 approval 的 plan 可以 append 精确 bytes，保留原始 bytes 和未知 sections；只在必要时补一个 newline separator。
- 精确的旧版 `cwd = "."` 和 root 已过期的精确 canonical sections，可在 approval 后原地迁移。
- 遇到重复/自定义 section、意外 absolute path、旧版 `--allow-write`、缺失 Hardened Apply prompt 或无法识别的结构时，报告 `manualReviewRequired`，不得自动应用。

绝不写入 environment values、headers、credentials、remote-network policy、user-level Codex config 或无关 MCP Server configuration。

## 新 Session / Host reload 与 capability 验证

每次 Codex config 写入都会返回 `RESTART_REQUIRED`。这个稳定 machine token 表示当前 runtime/session 不能用于可信的写后 capability verification，并不表示任何情况下都必须终止整个应用进程。停止当前流程，先启动新的 Codex chat/session。如果新 session 仍看到陈旧的 Tools、Skills 或 Server configuration，或 Host 界面没有明确的 fresh-session reload 行为，则完整重启 Codex Host 并重新验证。之后使用 Codex MCP status 确认 Server 已连接，列出实际 Tool 名称，并检查相关的 `inputSchema`。Config 文件是否存在、推断出的 configuration mode 以及用户报告的数量，都必须与观察到的 runtime capability 分开处理；没有新的实际 Tool/schema/runtime evidence 时，报告 `UNKNOWN / UNVERIFIED`：

| Directional count | 必须具备的 capability evidence | State |
| ---: | --- | --- |
| 3 | validate、inspect 和 diff 的名称，以及兼容的当前 Schemas | `MCP_ANALYSIS_ONLY` |
| 8 | 已配置的 catalog/search/contract/check Tools，加上支持 `write` 和 `dry-run` 或仅支持 `dry-run` 的 `openapi_generate` | 分别为 `MCP_DEVELOPER` 或 `MCP_READ_ONLY` |
| 10 | 八个已配置 Tools 加 Prepare/Apply 及兼容 Schemas；Host Apply prompt 仍启用 | `MCP_HARDENED` |

其他数量一律视为 unknown。数量相符但缺少 Tool 名称或 `inputSchema` 不兼容时，也属于 unknown 或 `BLOCKED`。Tool result 中的 capability fields 也是判定依据。Host 暴露 annotations 时，可用作佐证；若不可见，报告此限制，不要编造值，也不要仅因其隐藏而判定失败。不要只依据名称推断当前版本参数；仅凭八个 Tools 无法区分 Developer 与 Read-only。

<!-- Repository contract anchors (keep exact text; the Chinese guidance above is authoritative):
## macOS and Linux
## Native Windows
<ABSOLUTE_PROJECT_ROOT>
RESTART_REQUIRED
fresh Codex chat/session
actual Tool names
-->
