# openapi-to

OpenAPI compiler、CLI、官方 TypeScript generators 和本地 stdio MCP server 的 aggregate package。需要 Node.js 22+。

## 选择已发布版本

截至 2026-10-13，npm `latest` 为 V3 `3.2.2`，`rc` 为 `4.0.0-rc.3`。安装已发布 V4 RC：

```sh
pnpm add -D openapi-to@4.0.0-rc.3
pnpm exec openapi --help
```

RC.3 尚未包含 `openapi setup`，也没有当前 `main` 的 `pluginFaker` export。请勿对 RC.3 运行下面的候选版本 Setup。当前 `main` 的下一版 V4 candidate 发布后，应改用经验证的明确版本号；本 README 不将源码能力视为已经发布。

## 下一版 V4 candidate 的 CLI 与 Codex 路径

安装实际发布的候选版本后，可用 `openapi` / `openapi-to` 两个 CLI aliases 与 `openapi-to-mcp` stdio command。一个本地 JSON/YAML input 加 `pluginTSType()` 即可生成 types；完整可复制示例见 [仓库 Quick Start](https://github.com/openapi-to/openapi-to/blob/main/README.md)。

普通 Codex 首次 bootstrap 在已安装候选包的 pnpm project 中执行：

```sh
pnpm exec openapi setup --host codex --scope project --dry-run
pnpm exec openapi setup --host codex --scope project
```

Setup 包含 generation config、ignore rule、两个 packaged Skills 与 project MCP config，默认是 **Developer** generation mode，`openapi_generate` 可按明确意图持久写入。如需只预览，在 `.codex/config.toml` 的 MCP server `args` 中显式加入 `--generation-mode read-only`；`--generation-mode hardened` 使用 Prepare/Apply 和 Host approval。`openapi setup` 自身没有模式选项。Host config 改变返回 `RESTART_REQUIRED` 时，先新建 Codex session 并检查实际 Tool list / `inputSchema`；仍陈旧或 Host 无明确 session reload 路径时完整重启。`skills install` 仅是独立的高级 Skills 管理命令，不配置 MCP。见 [Codex 指南](https://github.com/openapi-to/openapi-to/blob/main/docs/codex-mcp.md)及 [安全边界](https://github.com/openapi-to/openapi-to/blob/main/docs/mcp-security.md)。

## 官方 factories 与支持范围

当前 `main` aggregate re-export `pluginTSType`、`pluginTSRequest`、`pluginZod`、`pluginSWR`、`pluginVueQuery`、`pluginReactQuery`、`pluginMSW` 和 `pluginFaker`。前七项为 `Stable`，Faker 为 `Partial`，NestJS 为 `Not Supported`。React Query consumer 必须自行提供 React 和 TanStack Query v5；Faker consumer 必须提供 `@faker-js/faker`。OpenAPI 3.2 为有界的 `Stable` Core/compiler contract，仍有 method、query plugin、MSW 和 streaming/wire/runtime 限制。各版本是否包含 factory 应以其实际 packed exports 为准；见 [Capability matrix](https://github.com/openapi-to/openapi-to/blob/main/docs/capability-matrix.md)。

MCP server API 从 `@openapi-to/mcp` 和 `@openapi-to/mcp/cli` 提供，不从 aggregate 顶层 re-export。迁移参见 [V4 指南](https://github.com/openapi-to/openapi-to/blob/main/docs/migration-v4.md)。
