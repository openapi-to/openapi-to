# openapi-to

从 OpenAPI 文档生成可重复构建的 TypeScript 代码。`openapi-to` 将 compiler、CLI、官方生成插件和本地 stdio MCP server 组合在一起：普通 codegen 工作流可以按 `Target` 管理多个 API 文档，AI Coding Agent 可以先发现 `Operation`，再选择需要生成的内容。

## 核心能力

- 同一套 Core 处理读取、解析、验证、差异分析、插件运行和生成文件所有权；`generate --check` 可在 CI 中发现生成漂移。
- 为每份 API 文档配置独立的 `Target`，避免不同服务的 operation 和 schema 相互混合。
- 官方插件覆盖 TypeScript types、request client、Zod、SWR、Vue Query、React Query、MSW，以及仍为 `Partial` 的 Faker。
- MCP 提供本地 Operation catalog 与选择性生成；写入能力由实际启动模式和 Host approval 决定。

> **预发布版本**：V4 稳定版尚未发布。以下 CLI 示例使用已发布的 `4.0.0-rc.3`；Codex `openapi setup` 和 `pluginFaker` 仅在当前源码中，须待包含它们的候选版本实际发布并核验后使用。npm `latest` 仍指向 V3。安装状态以 [npm dist-tags](https://www.npmjs.com/package/openapi-to?activeTab=versions) 为准。

## 快速开始（CLI）

以下流程使用 Node.js 22+ 和 pnpm。此路径使用 npm 已发布的 `4.0.0-rc.3`；不需要远程 Petstore 或额外 runtime peer。

```sh
pnpm add -D openapi-to@4.0.0-rc.3
mkdir -p openapi
```

创建本地 `openapi/pets.yaml`：

```yaml
openapi: 3.1.0
info:
  title: Pets
  version: 1.0.0
paths:
  /pets/{petId}:
    get:
      operationId: getPet
      parameters:
        - name: petId
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: A pet
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Pet'
components:
  schemas:
    Pet:
      type: object
      required: [id, name]
      properties:
        id:
          type: string
        name:
          type: string
```

创建 `openapi.config.ts`，只启用无需 request adapter 或其他 runtime peer 的 TypeScript types：

```ts
import { defineConfig, pluginTSType } from 'openapi-to'

export default defineConfig({
  servers: [{
    name: 'pets',
    input: { path: './openapi/pets.yaml' },
    output: { base: 'workspace', dir: 'src/api/generated/pets', clean: true },
  }],
  plugins: [pluginTSType()],
})
```

```sh
pnpm exec openapi validate ./openapi/pets.yaml
pnpm exec openapi generate --dry-run
pnpm exec openapi generate
pnpm exec openapi generate --check
```

`--dry-run` 只预览，`generate` 写入 `src/api/generated/pets/` 并记录文件所有权，`--check` 在磁盘产物过期时返回退出码 `6`。生成后可以在手写代码中使用经 RC.3 tarball 验证的类型：

```ts
import type { PetModel } from './api/generated/pets/types/models/pet.model.js'

const pet: PetModel = { id: 'p-1', name: 'Mochi' }
void pet
```
生成目录由工具管理，手写代码放在目录外。完整 CLI 选项与多 Target 配置见 [CLI guide](docs/cli.md)。

`openapi` and `openapi-to` are CLI aliases; `openapi-to-mcp` starts the stdio MCP server.

## AI Coding / Codex

`openapi setup` 尚未进入已发布的 RC.3。待包含该命令的候选版本发布并核验后，先安装其明确版本号，再在可信 pnpm project 根目录预览并执行：

```sh
pnpm exec openapi setup --host codex --scope project --dry-run
pnpm exec openapi setup --host codex --scope project
```

Setup 配置 generation config、state ignore rule、两个 consumer Skills 和 project MCP。Host 提示 `RESTART_REQUIRED` 时，新建 Codex chat/session 并核对实际 Tool list 与 `inputSchema`；若仍是旧配置，再重启 Host。随后用 MCP 搜索 `Operation`、读取 contract，再按选定的 `Target` 或 `Operation` 生成。默认 **Developer** 模式允许 `openapi_generate` 写入；Read-only 只预览，Hardened 的 Apply 需要独立的 Host approval。模式选择、3/8/8/10 Tools 的含义和完整流程见 [Codex MCP 指南](docs/codex-mcp.md)与 [MCP 安全边界](docs/mcp-security.md)。其他 Host 参见 [Claude Code](docs/ai-hosts/claude-code.md)、[Cursor](docs/ai-hosts/cursor.md)与 [generic stdio](docs/ai-hosts/generic-stdio.md) 指南。

已有 config 的高级用户可单独运行 `pnpm exec openapi skills install --host codex --scope project`；`project` 目标为 `$CWD/.agents/skills`，`user` 目标为 `$HOME/.agents/skills`。它不配置 MCP；`openapi init` 只创建 generation config 和 ignore rule。

## 能力与限制

| 领域 | 当前源码状态 | 关键边界 |
| --- | --- | --- |
| Swagger 2.0、OpenAPI 3.0 / 3.1 | `Stable` | 按官方插件覆盖的 constructs 处理。 |
| OpenAPI 3.2 | `Stable`（有界 Core/compiler contract） | `QUERY` 和 custom methods 的插件支持不同；streaming、item-level、positional wire/runtime 尚未完整支持。 |
| TypeScript、request、Zod、SWR、Vue Query、React Query、MSW | `Stable` | React Query consumer 自行提供 React 和 TanStack Query v5；Zod 要求 4.3+。 |
| Faker | `Partial` | 当前 `main` 有第八个官方 factory `pluginFaker`；已发布 RC.3 aggregate 无此 export。 |
| NestJS generator | `Not Supported` | 无官方 package 或 aggregate export。 |
| MCP | `Stable`（有界） | No-config / Developer / Read-only / Hardened 分别为 3 / 8 / 8 / 10 Tools；写入能力以实际模式和 Host approval 为准。 |

[Capability matrix](docs/capability-matrix.md) 是完整状态与限制参考；尤其参见 OpenAPI 3.2 的 `querystring`、MSW、query plugins 与 streaming 限制，和 [request transport / Cookie / Header 细节](docs/request-transport.md)。表中 `main` 能力不等于 npm 已发布能力。

## 深入使用

- [Getting Started](docs/getting-started.md)：安装、CLI 与 MCP 路线。
- [CLI guide](docs/cli.md)：多 Target、输入策略、输出所有权与 CI 检查。
- [Capability matrix](docs/capability-matrix.md)：官方 plugins、dialects 与逐项限制。
- [Compiler API 与诊断](packages/core/README.md)：Core API、diagnostics 和生成结果。
- [Codex MCP](docs/codex-mcp.md)、[MCP security](docs/mcp-security.md) 和 [Troubleshooting](docs/troubleshooting.md)。
- [V4 migration / breaking changes](docs/migration-v4.md)：V4 与 V2 不兼容；[历史 V2 文档](https://github.com/Vc-great/openapi-to/tree/v2) 仅供迁移对照。
- [维护者文档](docs/maintainers/README.md)与 [Issues](https://github.com/openapi-to/openapi-to/issues)。
