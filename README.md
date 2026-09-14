[![codecov](https://codecov.io/github/Vc-great/openapi-to/branch/V2/graph/badge.svg?token=5UB04YYCEB)](https://codecov.io/github/Vc-great/openapi-to)

当前版本与 V2 不兼容，请参阅 [V2 文档](https://github.com/Vc-great/openapi-to/tree/v2)。

# 项目概览

`openapi-to` 是面向 Swagger/OpenAPI 文档的 TypeScript compiler、CLI、代码生成工具集和本地 stdio MCP server。发布的 aggregate package 包含 TypeScript 类型与 request client、Zod schema、SWR hooks、Vue Query hooks、MSW handlers，以及 MCP runtime。Faker、NestJS 和 React Query generator 不在发布范围内。

推荐按这条路径开始：

1. 阅读 [快速开始](docs/getting-started.md)，完成安装和第一次生成。
2. 使用 [CLI generation guide](docs/cli.md) 配置多个 `Target` 或检查生成输出。
3. 通过 [Capability matrix](docs/capability-matrix.md) 判断 dialect、package 和 plugin 的实际边界。
4. 遇到问题时查看 [Troubleshooting](docs/troubleshooting.md)。

本仓库采用 Chinese-first、not Chinese-only 的文档策略。自然语言优先使用简体中文；命令、路径、package name、API、CLI option、MCP Tool、JSON/YAML field 和其他 technical identifiers 保持可复制的原始形式。

`openapi-to-setup` 负责消费项目的 package、config、ignore 和 Codex MCP 状态诊断；`openapi-to-generate` 负责在 MCP 上发现 `Operation`、选择性预览和生成后集成。它们是独立的 consumer Agent Skills，不会改变 compiler、CLI 或 MCP server 的边界。请先完成 Setup，再使用 Generate。

## 当前能力边界

- Repository development 和 test commands 要求 Node.js 22.13+；published packages 支持 Node.js 22+。
- 支持本地 JSON/YAML/YML 和受策略约束的 HTTP(S) input，覆盖 Swagger 2.0、OpenAPI 3.0 和 OpenAPI 3.1。
- OpenAPI 3.2 仅以 compatibility mode 读取，并对 generator gaps 给出 diagnostics，不代表完整的 3.2 generation support。
- CLI 提供稳定的 `validate`、`inspect`、`diff` 和 `generate` contracts，JSON 输出确定性且使用集中式 exit codes。
- MCP 默认是本地 stdio、read-only；受 operator gating 的 Prepare/Apply 才能启用写入。
- Zod generation 仅支持 Zod 4，且状态为 `Partial`；`oneOf` 是普通 union，不提供 exact-one validation。

精确的 package、dialect、CLI 和 MCP 状态以 [Capability matrix](docs/capability-matrix.md) 为准，不在 README 中复制完整 reference。

## 快速开始

### 安装

```shell
pnpm add -D openapi-to
```

安装 aggregate package 会同时提供 `openapi`、`openapi-to` 两个 CLI aliases，以及 `openapi-to-mcp` stdio server command。

`openapi` and `openapi-to` are CLI aliases; `openapi-to-mcp` starts the stdio MCP server.

### 安装 Codex consumer Skills

安装包内带有版本匹配的 `openapi-to-setup` 和 `openapi-to-generate` assets。Codex 用户可以先预览，再显式安装；安装过程不访问网络：

```shell
pnpm exec openapi skills install \
  --host codex \
  --dry-run

pnpm exec openapi skills install \
  --host codex
```

当前支持的 installer Host 只有 `codex`。安装器写入 `$CODEX_HOME/skills`；未设置 `CODEX_HOME` 时使用 `~/.codex/skills`。它不会覆盖已有 Skill directory，也不提供 force、update 或 uninstall。安装后请 Restart Codex（重启 Codex）。

`pnpm add`、`pnpm install` 和 `openapi init` 都不会自动安装 Skills。Skill installer 也不会配置 MCP；重启后使用 `openapi-to-setup` 检查项目和 Host。

### 使用方式

```json [package.json]
{
  "scripts": {
    "openapi:init": "openapi init",
    "openapi:generate": "openapi g"
  }
}
```

### 常用命令

验证和 inspection 不要求 generation config：

```shell
pnpm exec openapi init
pnpm exec openapi validate ./openapi.yaml
pnpm exec openapi inspect ./openapi.yaml --json
pnpm exec openapi diff ./old.yaml ./new.yaml --fail-on-breaking
pnpm exec openapi generate --dry-run --json
pnpm exec openapi generate --check --json
pnpm exec -- openapi-to-mcp --help
pnpm exec -- openapi-to-mcp --workspace-root .
```

`init` 在 Workspace root 创建 `openapi.config.ts`（ESM）或 `openapi.config.js`（CommonJS），并只向 `.gitignore` 添加 `/.openapi-to/`。Generation 会向上查找最近的 `openapi.config.ts`、`.js`、`.cjs` 或 `.mjs`；同一 candidate directory 存在多个候选文件时，会在执行配置代码前失败。用 `--config <path>` 可以显式选择配置文件。

`--json` 向 stdout 写入一个 JSON document，diagnostics 和 plugin incidental logs 写入 stderr。`--dry-run` 执行 plugins 并报告 artifact manifest，但不写文件；`--check` 比较生成结果，过期时失败。`output.clean` 只依据之前的 `.openapi-to-manifest.json` 删除已拥有的文件，不删除 unmanaged user files。

Exit codes 保持稳定：`0` success、`1` general failure、`2` config failure、`3` OpenAPI parse/validation/ref failure、`4` input 或 remote load failure、`5` plugin failure、`6` outdated generated output、`7` `diff --fail-on-breaking` 检测到 breaking changes。

详细的 `Target` 选择、输出 ownership 和 remote input 规则见 [CLI generation guide](docs/cli.md)。

## 多个 OpenAPI 文档

一个 `Target` 是一个独立生成边界：包含稳定名称、一个 input、一个 output root 和一个 ownership manifest。一个 `Operation` 是 Target 内的 endpoint。不同 Target 可以拥有相同的 `operationId` 或 Schema name；不要把多个 microservice document 隐式合并。

```ts
import { defineConfig } from 'openapi-to'

export default defineConfig({
  servers: [
    {
      name: 'user-service',
      input: { path: './openapi/user.json' },
      output: {
        base: 'workspace',
        dir: 'src/api/generated/user',
        clean: true,
      },
    },
    {
      name: 'order-service',
      input: { path: './openapi/order.yaml' },
      output: {
        base: 'workspace',
        dir: 'src/api/generated/order',
        clean: true,
      },
    },
    {
      name: 'payment-service',
      input: {
        path: 'https://api.example.com/openapi?service=payment',
      },
      output: { dir: 'payment' },
    },
  ],
})
```

`output.base` 默认为 `managed`，例如 `dir: 'payment'` 会写入 `.openapi-to/payment`；`base: 'workspace'` 会写入 Workspace 下的 generator-managed directory，并在 output root 中保留 ownership manifest。手写扩展应放在独立路径，例如 `src/api/custom`。

`input.path` 支持 Workspace-relative path，以及仍位于 Workspace 内的 absolute path（包括 native Windows `C:\...` 和 `C:/...`）。Drive-relative path（如 `C:openapi.yaml`）、UNC path 和 `file:` URL 会被拒绝。`output.dir` 还必须避开 Windows reserved device names、reserved characters、control characters，以及以 period 或 space 结尾的 segment。

`openapi generate` 默认处理所有 Targets；重复 `--target` 可按 configuration order 选择多个 Target，重复名称会去重。未知 Target、unsafe output 或 overlapping output 会在写入前失败。多 Target generation 的每个 Target 有独立 ownership/transaction boundary，不承诺跨目录 global rollback。

## MCP server

aggregate installation 已提供 MCP command，不需要额外安装 MCP package：

```shell
pnpm exec -- openapi-to-mcp --help
pnpm exec -- openapi-to-mcp --workspace-root .
pnpm exec -- openapi-to-mcp --workspace-root . --config ./openapi.config.ts
pnpm exec -- openapi-to-mcp --workspace-root . --config ./openapi.config.ts --allow-write
```

安全默认值是 local stdio 和 no writes。`--config` 会增加 read-only catalog 与 generation preview/check Tools；`--allow-write` 才会注册现有 Prepare/Apply Tools，但不会绕过 Host approval。MCP 的 exact Tool matrix 和 capability boundary 见 [Capability matrix](docs/capability-matrix.md)。

需要独立 package boundary 的 advanced users 可以安装 `@openapi-to/mcp`；它提供同一个 `openapi-to-mcp` command，以及 `@openapi-to/mcp` 和 `@openapi-to/mcp/cli` programming interfaces。MCP server internals 不会从 aggregate package 的顶层 JavaScript API re-export。

不同 AI Host 的配置入口：

- [Codex](docs/codex-mcp.md)
- [Claude Code](docs/ai-hosts/claude-code.md)
- [Cursor](docs/ai-hosts/cursor.md)
- [Generic stdio Host](docs/ai-hosts/generic-stdio.md)

所有 Host 共用 [security boundary](docs/mcp-security.md) 和 [Troubleshooting](docs/troubleshooting.md)。

## Compiler API 与 plugins

Core 是 compiler semantics authority，负责读取、解析、验证、inspection、first-stage diff、diagnostics、plugin runtime 和 generated artifacts。以下 API 同时从 `@openapi-to/core` 和 `openapi-to` 导出：

```ts
import {
  compileOpenAPI,
  resolveOpenAPIReferences,
  validateOpenAPIDocument,
  inspectOpenAPIDocument,
  diffOpenAPIDocuments,
} from 'openapi-to'
```

aggregate package 额外 re-export 六个官方 plugin factories：

| Factory | 用途 | 状态 |
| --- | --- | --- |
| `pluginTSType` | TypeScript types | `Stable` |
| `pluginTSRequest` | TypeScript request client | `Stable` |
| `pluginZod` | Zod 4 schemas | `Partial` |
| `pluginSWR` | SWR hooks | `Stable` |
| `pluginVueQuery` | Vue Query hooks | `Stable` |
| `pluginMSW` | Mock Service Worker handlers | `Stable` |

Faker、NestJS 和 React Query generator 没有官方 package、aggregate export 或 published runtime。完整范围、OpenAPI dialect 边界和 MCP Tool 状态以 [Capability matrix](docs/capability-matrix.md) 为准。

### 配置示例

```typescript
import { defineConfig, pluginTSRequest, pluginTSType, pluginZod } from 'openapi-to'

export default defineConfig({
  servers: [
    {
      input: {
        path: 'https://petstore.swagger.io/v2/swagger.json',
      },
      output: {
        dir: 'server',
      },
    },
  ],
  plugins: [
    pluginZod(),
    pluginTSType(),
    pluginTSRequest({
      parser: 'zod',
      requestClient: 'axios',
      requestImportDeclaration: {
        moduleSpecifier: '@/utils/request',
      },
      requestConfigTypeImportDeclaration: {
        namedImports: ['AxiosRequestConfig'],
        moduleSpecifier: 'axios',
      },
    }),
  ],
})
```

`pluginTSRequest` 默认使用 Axios，也可以配置其他 request client。生成的 header/cookie metadata 不会增加独立的 `headers` 或 `cookies` method parameters；调用方通过现有的 request configuration/client configuration 传值。

```ts
import type { AddPetMutationRequest } from './add-pet.types'
import { addPetService } from './add-pet.service'

const pet: AddPetMutationRequest = {
  name: 'Fido',
  photoUrls: [],
}

await addPetService(pet, {
  headers: {
    'X-Request-Id': 'request-123',
  },
})
```

`pluginZod` 只支持 Zod 4：

```shell
pnpm add zod@^4
```

`oneOf` 和 `anyOf` 生成普通 `z.union([...])`；`oneOf` 不提供 JSON Schema 的 “exactly one branch” 语义。`allOf` 生成 `z.intersection(...)`。不安全或不支持的组合会产生 structured diagnostic，而不是静默忽略。

## Repository development

Repository development 和 release verification 不是普通用户安装路径。需要从 source checkout 调试 MCP 时：

```shell
pnpm install
pnpm build
node packages/mcp/bin/openapi-to-mcp.js --workspace-root .
```

Repository-only health/Inspector commands 不会发布到 npm package：

```shell
pnpm mcp:check
pnpm --silent mcp:check -- --json
pnpm mcp:inspect
pnpm mcp:inspect -- --allow-write
```

`mcp:inspect` 是 foreground、authenticated localhost 的人工检查入口，不是 CI gate，也不替代 stdio、controlled-write、recovery 或 performance tests。维护者的完整 release checks 见 [getting-started guide](docs/getting-started.md) 与 [Capability matrix](docs/capability-matrix.md)。
