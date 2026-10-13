# openapi-to

从 OpenAPI 文档生成 TypeScript 代码的 aggregate package，包含 compiler、CLI、官方生成插件和本地 stdio MCP server。以下 V4 工作流使用 Node.js 22+。完整的本地文件与配置示例见 [仓库快速开始](https://github.com/openapi-to/openapi-to/blob/main/README.md#快速开始cli)。

> **预发布版本**：V4 稳定版尚未发布。npm `latest` 仍是 V3；已发布的 V4 `rc` 为 `4.0.0-rc.3`。`openapi setup` 和 `pluginFaker` 尚未进入该 RC，须待包含它们的候选版本实际发布并核验后使用。请核对 [npm 版本列表](https://www.npmjs.com/package/openapi-to?activeTab=versions)。

## 安装与 CLI

以下命令使用已发布的 RC.3：

```sh
pnpm add -D openapi-to@4.0.0-rc.3
pnpm exec openapi --help
```

`openapi` 与 `openapi-to` 是同一 CLI 的 aliases；`openapi-to-mcp` 启动 stdio MCP server。用 `pluginTSType()` 和本地 OpenAPI 文件即可生成类型；完整可复制的 `validate`、`generate`、`--check` 和 TypeScript import 示例见[仓库快速开始](https://github.com/openapi-to/openapi-to/blob/main/README.md#快速开始cli)。

## AI Coding / Codex

当前源码提供 `openapi setup --host codex --scope project`，但已发布的 RC.3 不提供该命令。待包含它的候选版本发布并安装后，按 [Codex MCP 指南](https://github.com/openapi-to/openapi-to/blob/main/docs/codex-mcp.md)完成 Setup、Host Tool 核验、`Operation` 发现与选择性生成。Setup 默认配置 **Developer** 模式，可按明确意图写入；Read-only 只预览，Hardened Apply 需要 Host approval。具体边界见 [MCP 安全指南](https://github.com/openapi-to/openapi-to/blob/main/docs/mcp-security.md)。

## 支持范围与文档

当前源码的官方 factories 包括 TypeScript types、request、Zod、SWR、Vue Query、React Query、MSW 和 Faker；Faker 为 `Partial`，NestJS generator 为 `Not Supported`。已发布 RC.3 不含 `pluginFaker`。React Query consumer 需提供 React 和 TanStack Query v5，Zod 需要 4.3+，Faker consumer 需提供 `@faker-js/faker`。OpenAPI 3.2 的 Core/compiler contract 为有界 `Stable`，不代表完整 streaming、item-level 或 positional wire/runtime 支持。版本能力以实际 tarball 为准，细节见 [Capability matrix](https://github.com/openapi-to/openapi-to/blob/main/docs/capability-matrix.md)。

更多资料：[CLI](https://github.com/openapi-to/openapi-to/blob/main/docs/cli.md) · [Getting Started](https://github.com/openapi-to/openapi-to/blob/main/docs/getting-started.md) · [V4 Migration](https://github.com/openapi-to/openapi-to/blob/main/docs/migration-v4.md) · [Troubleshooting](https://github.com/openapi-to/openapi-to/blob/main/docs/troubleshooting.md)。
