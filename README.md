# openapi-to

从 OpenAPI 文档生成可重复构建的 TypeScript 代码：一个 compiler、CLI、官方 plugins 和本地 stdio MCP server。它适合将多个 API 文档分别生成到受管理的目录，也支持 AI Coding Agent 按 Operation 发现和选择性生成。

## 为什么使用 openapi-to

- 同一套 Core 处理读取、解析、验证、差异分析、插件运行和生成文件所有权；`generate --check` 可在 CI 中发现生成漂移。
- 为每份 API 文档配置独立的 `Target`，避免不同服务的 operation 和 schema 相互混合。
- 官方插件覆盖 TypeScript types、request client、Zod、SWR、Vue Query、React Query、MSW，以及仍为 `Partial` 的 Faker。
- MCP 提供本地 Operation catalog 与选择性生成；写入能力由实际启动模式和 Host approval 决定。

> **发布渠道（2026-10-13 核验）**：npm `latest` 是 V3 `3.2.2`，`rc` 是 `4.0.0-rc.3`。下文 CLI 示例可直接使用已发布的 RC.3；Codex `openapi setup` 则属于**待发布的下一版 V4 candidate / 当前 `main`**。RC.3 尚无该命令，也未包含当前 Faker export。不要用无版本的 `pnpm add -D openapi-to` 运行 V4 命令。已发布版本见 [npm dist-tags](https://www.npmjs.com/package/openapi-to?activeTab=versions)。

## Quick Start：CLI（已发布 V4 RC.3）

需要 Node.js 22+ 和 pnpm。此路径使用 npm 已发布的 `4.0.0-rc.3`；不需要远程 Petstore 或额外 runtime peer。

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

## Quick Start：AI Coding / Codex（下一版 V4 candidate）

RC.3 不支持 `openapi setup`。下一版候选版本**实际发布并验证**后，先将项目安装版本更新为该明确版本号，再在可信 pnpm project 根目录运行：

```sh
pnpm exec openapi setup --host codex --scope project --dry-run
pnpm exec openapi setup --host codex --scope project
```

Setup 预览后会建立 generation config、state ignore rule、两个 packaged consumer Skills 和 project `.codex/config.toml`。它默认配置 **Developer** MCP：有可信 config 时为八个 Tools，`openapi_generate` 可按明确的生成意图写入。若只允许预览，在 `.codex/config.toml` 的 MCP server `args` 中显式加入 `--generation-mode read-only`；若需要 Prepare、逐计划批准和 Apply，则在该处选择 `--generation-mode hardened`，并由 Host 对 Apply 提示批准。`openapi setup` 自身没有 `--generation-mode` 选项。无 config 只有三个 analysis Tools；Developer / Read-only 均为八个，Hardened 为十个。**数量不能证明写入权限**，要检查实际 Tool list、`inputSchema` 和 Host approval。

若 Setup 报 `RESTART_REQUIRED`，先新建 Codex chat/session 并核对实际 Tools；若仍读到旧配置，或 Host 没有明确的 session reload 路径，再完整重启 Host 复查。`skills install` 是独立的高级 Skill 管理入口，不配置 MCP，也不替代首次 Setup。高级用户可运行 `pnpm exec openapi skills install --host codex --scope project`；`project` 目标是 `$CWD/.agents/skills`，`user` 目标是 `$HOME/.agents/skills`。单独运行 `openapi init` 只初始化 generation config 和 ignore rule，不安装 Skills。详见 [Codex MCP 指南](docs/codex-mcp.md) 和 [MCP 安全边界](docs/mcp-security.md)。[Claude Code](docs/ai-hosts/claude-code.md)、[Cursor](docs/ai-hosts/cursor.md) 和 [generic stdio Host](docs/ai-hosts/generic-stdio.md) 使用各自的配置指南；Codex Setup 不安装这些 Host。

## 能力与限制

| 领域 | 当前 `main` 状态 | 关键边界 |
| --- | --- | --- |
| Swagger 2.0、OpenAPI 3.0 / 3.1 | `Stable` | 按官方插件覆盖的 constructs 处理。 |
| OpenAPI 3.2 | `Stable`（有界 Core/compiler contract） | `QUERY` 和 custom methods 的插件支持不同；streaming、item-level、positional wire/runtime 尚未完整支持。 |
| TypeScript、request、Zod、SWR、Vue Query、React Query、MSW | `Stable` | React Query consumer 自行提供 React 和 TanStack Query v5；Zod 要求 4.3+。 |
| Faker | `Partial` | 当前 `main` 有第八个官方 factory `pluginFaker`；已发布 RC.3 aggregate 无此 export。 |
| NestJS generator | `Not Supported` | 无官方 package 或 aggregate export。 |
| MCP | 3 / 8 / 8 / 10 Tools | 依 no-config / Developer / Read-only / Hardened 模式及实际 schema 判断能力。 |

[Capability matrix](docs/capability-matrix.md) 是完整状态与限制参考；尤其参见 OpenAPI 3.2 的 `querystring`、MSW、query plugins 与 streaming 限制，和 [request transport / Cookie / Header 细节](docs/request-transport.md)。表中 `main` 能力不等于 npm 已发布能力。

## 深入使用

- [Getting Started](docs/getting-started.md)：安装、CLI 与 MCP 路线。
- [CLI guide](docs/cli.md)：多 Target、输入策略、输出所有权与 CI 检查。
- [Capability matrix](docs/capability-matrix.md)：官方 plugins、dialects 与逐项限制。
- [Compiler API 与诊断](docs/capability-matrix.md)：Core API 与 diagnostics；aggregate 从 `openapi-to` re-export Core 和当前源码的八个 plugin factories。
- [Codex MCP](docs/codex-mcp.md)、[MCP security](docs/mcp-security.md) 和 [Troubleshooting](docs/troubleshooting.md)。
- [V4 migration / breaking changes](docs/migration-v4.md)：V4 与 V2 不兼容；[历史 V2 文档](https://github.com/Vc-great/openapi-to/tree/v2) 仅供迁移对照。
- [维护者文档](docs/maintainers/README.md) 与仓库 [Issue / Pull Request](https://github.com/openapi-to/openapi-to/issues) 入口。
