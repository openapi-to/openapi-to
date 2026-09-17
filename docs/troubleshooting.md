# Troubleshooting

本文按“症状 → 原因 → 检查/修复”组织。命令、error token、path、environment variable、exit code 和 diagnostic code 保持原样，便于直接复制和搜索。

## Host 报告 “connection closed”

先在 Workspace 中运行相同 command：

```sh
pnpm exec -- openapi-to-mcp --help
```

如果使用 source checkout，请先运行 `pnpm build`，再执行 `node packages/mcp/bin/openapi-to-mcp.js`。Confirm Node.js is 22.13 or newer for repository commands；Published packages retain a Node.js 22 or newer runtime floor。确认 Host 使用预期的 Workspace 作为 working directory。

`openapi-to-mcp` 会把启动失败写成有界、脱敏的 stderr diagnostic，包含 `phase` 与稳定 `code`，但不会输出 raw error、stack、环境、凭据或绝对项目路径：

- `MCP_STARTUP_INVALID_ARGUMENT`：参数解析或 bounded option validation 失败。
- `MCP_STARTUP_WORKSPACE_UNAVAILABLE`：Workspace 无法安全解析。
- `MCP_STARTUP_CONFIG_UNAVAILABLE`：write-enabled startup preflight 消费 trusted config 失败。
- `MCP_STARTUP_CONNECT_FAILED`：stdio transport/server connect 阶段失败。
- `MCP_STARTUP_FAILED`：未能安全归入更具体类别的 startup failure。

这些诊断只描述 openapi-to runtime；它们不证明 Codex Desktop 的 root cause。若 Inspector、Host restart、official SDK/Codex CLI control 与 Desktop 结果满足“SDK/CLI 成功但 Desktop 在 initialize 失败”，Setup 才能使用 `MCP_HOST_COMPATIBILITY_SUSPECTED`；否则保持 `MCP_SERVER_UNAVAILABLE` 或 `MCP_STARTUP_FAILED`，并标注 evidence source。相关 Host evidence 见 upstream [openai/codex#45555](https://github.com/openai/codex/issues/45555)。

在 native Windows 上，JSON/TOML Host 可能无法直接执行 `.cmd` shim。请使用 `command: "cmd.exe"` 配合 `/d /s /c` 和完整的 `pnpm exec -- openapi-to-mcp ...` command，或使用 `node.exe` 配合 source bin path。不要把 POSIX `/path/...` 示例直接复制到 Windows configuration。

## Host 没有显示 Tools

MCP process 必须持续运行在 stdio 上。确认没有 wrapper 向 stdout 写入内容，并确认 Host configuration 使用 stdio `command`/`args`，而不是 HTTP URL。修改配置后重启 Host。

预期 Tool 数量：

- 没有 `--config`：3
- 有 trusted `--config`：8
- 有 trusted `--config` 且带 `--allow-write`：10

Tool count 不是 capability proof；必须同时检查实际 Tool names、current `inputSchema` 和 capability fields。Desktop 的 process lifecycle、effective cwd、child stderr 与 initialize wire exchange 不能由 repository Inspector 自动观察，因此 Desktop acceptance 保留为 supervised/manual evidence。

canonical project-relative configuration 仍使用 `cwd = "."`。将 cwd 改为 absolute path 只能作为 machine-local、manual、不要提交的诊断实验，不能作为 root-cause proof、canonical config 或自动 Setup Plan action。

## Configured Tools 缺失

Config path 必须存在于 Workspace 内，不能通过 symlink escape，并且必须导出有效的 project configuration。它是 startup 时选择的 trusted executable code，并在 server lifetime 内缓存；修改 config 或 OpenAPI source 后请重启。

没有 `--config` 时不能使用 `--allow-write`。Output roots 也必须先通过 Workspace validation，write Tools 才会注册。

对于 CLI auto-discovery，最近的 configuration directory 中只能保留一个 `openapi.config.ts`、`.js`、`.cjs` 或 `.mjs`。`OPENAPI_CONFIG_AMBIGUOUS` 表示存在多个 candidate；移除不需要的文件，或传入显式 `--config <path>`。`.openapi-to` 和旧 state directory 下的文件不会被 auto-discover。

## JSON-RPC 被污染

stdout 保留给 MCP protocol messages。Diagnostics、banner、debug output 和 plugin incidental logging 必须发送到 stderr。Embedding server 时，不要使用会向 stdout 写 status line 的 wrapper。

诊断时可以使用 `--log-level debug`，但 logs 必须留在 stderr。结构化 operational logs 使用 `--log-format json`；它们是 stderr 上的 NDJSON，不是 Tool-result JSON。

## Local 或 remote source 被拒绝

Local sources 和 transitive local `$ref` 必须位于真实 Workspace 内。应修复 traversal/symlink escape，不要直接扩大 Workspace。

Remote inputs 只允许 HTTP(S)，默认拒绝 private/reserved addresses。Operator 可以重复传入 `--allow-host <hostname>`；`--allow-private-network` 会降低 security boundary，只应对 trusted internal source 使用。

## Generation check 报告 outdated

这是预期的 business result，不是 MCP protocol failure。检查 bounded change summary。Write-enabled mode 应调用 Prepare，review exact hash，再按照 Host policy approve 对应 Apply；不要自动 Prepare 和 Apply。

CLI 中 `openapi generate --target <name> --check` 只检查选中的 Target。Name unknown 时检查显式的 `servers[].name`；legacy `server1`、`server2` fallback 可兼容，但不推荐作为持久的 microservice identity。

## Configured output 被拒绝

每个 Target 都需要独立 output root。即使只请求其中一个 Target，也会拒绝 equal roots 和 parent/child 组合，例如 `src/api/generated` 与 `src/api/generated/order`。同样会拒绝 Workspace root、absolute/drive/UNC paths、traversal、symlink、`.git`、`node_modules` 和 `.openapi-to` selection/transaction/lock state。

`base: 'workspace'` 仍表示 generator-managed。手写代码应放在独立 path，例如 `src/api/custom`。从默认 managed output 切换到 workspace output 不会迁移或移除旧 `.openapi-to` directory；请先验证新结果，再手动清理旧目录。

## Plan 过期、stale 或已使用

重新创建 Prepare plan 并再次 review。Tokens 短时有效、一次性、process-bound 且 plan-bound。Apply 会拒绝已变化的 input/config/reference/output/ownership/artifact state，而不会静默采用新状态。

## 出现 lock 或 recovery diagnostic

CLI generation 和 MCP Apply 共用 output lock。等待 active writer，或调查诊断中指出的 stale/recovery state。不要盲目删除 locks、journals、staging 或 backups；请遵循 [recovery guide](./mcp-write-recovery.md)。

## Doctor 和 Inspector

在 repository checkout 中先运行 `pnpm build`：

```sh
pnpm mcp:check
pnpm --silent mcp:check -- --json
pnpm mcp:inspect
```

Doctor 和 Inspector 仅用于 repository，不会进入 npm tarball。Installed-package users 应运行 `openapi-to-mcp --help`，并使用 Host 的 Tool-list/status UI。Inspector 是 interactive foreground surface，不应在 CI 中运行。
