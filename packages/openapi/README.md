# openapi-to

`openapi-to` 是 aggregate package，提供 OpenAPI compiler、CLI、official TypeScript generator plugins 和本地 stdio MCP server。

```sh
pnpm add -D openapi-to
pnpm exec openapi skills install --host codex --scope project --dry-run
pnpm exec openapi skills install --host codex --scope project
pnpm exec openapi --help
pnpm exec -- openapi-to-mcp --help
```

安装后，`openapi` 和 `openapi-to` 是同一个 CLI entrypoint 的 aliases，并提供独立的 `openapi-to-mcp` stdio command。它 re-export Core 和以下 factories：

- `pluginTSType`
- `pluginTSRequest`
- `pluginZod`
- `pluginSWR`
- `pluginVueQuery`
- `pluginReactQuery`
- `pluginMSW`

React Query generator 仅生成代码；generated consumer 应显式提供 TanStack Query v5 和 React dependencies。Faker 和 NestJS generators 不在其中。

显式执行 `skills install` 会把安装包内版本匹配的两个 consumer Skills 复制到显式选择的 `.agents/skills`：`project` 是 `$CWD/.agents/skills`，`user` 是 `$HOME/.agents/skills`。它不读取 `CODEX_HOME` 作为新 destination，不访问网络，也不会覆盖已有目录；历史 `~/.codex/skills` 只会触发 warning，不会自动迁移。安装后请重启 Codex。Package installation 和 `openapi init` 都不会自动安装 Skills，installer 也不会配置 MCP。

aggregate package 在 runtime 上依赖 `@openapi-to/mcp`，仅用于提供共享 command。MCP server APIs 仍从 `@openapi-to/mcp` 和 `@openapi-to/mcp/cli` 提供；它们不会从 `openapi-to` 顶层 JavaScript API re-export。

参阅仓库的 [快速开始](../../docs/getting-started.md) 和 [Capability matrix](../../docs/capability-matrix.md)。
