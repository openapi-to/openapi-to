[![codecov](https://codecov.io/github/Vc-great/openapi-to/branch/V2/graph/badge.svg?token=5UB04YYCEB)](https://codecov.io/github/Vc-great/openapi-to)

当前版本与 V2 不兼容，请参阅 [V2 文档](https://github.com/Vc-great/openapi-to/tree/v2)。

# 项目概览

`openapi-to` 是面向 Swagger/OpenAPI 文档的 TypeScript compiler、CLI、代码生成工具集和本地 stdio MCP server。发布的 aggregate package 包含 TypeScript 类型与 request client、Zod schema、SWR hooks、Vue Query hooks、TanStack Query v5 primitives、MSW handlers，以及 MCP runtime。Faker 和 NestJS generator 不在发布范围内。

推荐按这条路径开始：

1. 阅读 [快速开始](docs/getting-started.md)，完成安装和第一次生成。
2. 使用 [CLI generation guide](docs/cli.md) 配置多个 `Target` 或检查生成输出。
3. 通过 [Capability matrix](docs/capability-matrix.md) 判断 dialect、package 和 plugin 的实际边界。
4. 遇到问题时查看 [Troubleshooting](docs/troubleshooting.md)。

本仓库采用 Chinese-first、not Chinese-only 的文档策略。自然语言优先使用简体中文；命令、路径、package name、API、CLI option、MCP Tool、JSON/YAML field 和其他 technical identifiers 保持可复制的原始形式。

`openapi setup --host codex --scope project` 是普通首次 onboarding 的 deterministic bootstrap authority；`openapi-to-setup` 负责 degraded diagnosis、recovery、Codex session reload 和实际 MCP capability verification，`openapi-to-generate` 负责在 MCP 上发现 `Operation`、选择性预览和生成后集成。请先完成 Setup，再使用 Generate。

## 当前能力边界

- Repository development 和 test commands 要求 Node.js 22.13+；published packages 支持 Node.js 22+。
- 支持本地 JSON/YAML/YML 和受策略约束的 HTTP(S) input，覆盖 Swagger 2.0、OpenAPI 3.0 和 OpenAPI 3.1。
- OpenAPI 3.2 以 compatibility mode 读取。Core 会统一发现 `query` 与 `additionalOperations`；TypeScript types、Zod 和 request plugin 可生成它们，React Query、Vue Query 和 SWR 将 `QUERY` 作为携带 body/query 的 query 生成。其他 custom methods 在 query plugins 中 fail closed，MSW 对 `QUERY` 与 custom methods 均 fail closed；这仍不代表完整的 3.2 generation support。
- CLI 提供稳定的 `validate`、`inspect`、`diff` 和 `generate` contracts，JSON 输出确定性且使用集中式 exit codes。
- MCP 无 config 时是本地 stdio、analysis-only；trusted config 默认是 Developer，统一 `openapi_generate` 按用户意图支持 write 或 dry-run。显式 Read-only 只允许 dry-run，Hardened 的持久化写入仍需受 operator gating 的 Prepare/Apply。
- Zod generation 支持 Zod 4.3+，状态为 `Stable`；`oneOf` runtime validator 要求恰好一个分支匹配。

精确的 package、dialect、CLI 和 MCP 状态以 [Capability matrix](docs/capability-matrix.md) 为准，不在 README 中复制完整 reference。

## 快速开始

### 安装

```shell
pnpm add -D openapi-to
```

安装 aggregate package 会同时提供 `openapi`、`openapi-to` 两个 CLI aliases，以及 `openapi-to-mcp` stdio server command。

`openapi` and `openapi-to` are CLI aliases; `openapi-to-mcp` starts the stdio MCP server.

### 安装 Codex consumer Skills

普通首次 onboarding 推荐一条命令完成 project bootstrap：

```shell
pnpm exec openapi setup --host codex --scope project --dry-run
pnpm exec openapi setup --host codex --scope project
```

该 command 只支持已安装的 pnpm aggregate package、Codex project scope 和默认 Developer MCP；会按 bounded preflight 初始化 generation config、维护 `/.openapi-to/`、安装两个 packaged Skills，并追加 project `.codex/config.toml`。Host config 发生变化后返回 `RESTART_REQUIRED`：先新建 Codex chat/session，再检查实际 Tool list 和 inputSchema；若仍是旧能力或当前 Host 没有明确的 session reload 路径，再完整重启 Codex Host 并复查。

安装包内带有版本匹配的 `openapi-to-setup` 和 `openapi-to-generate` assets。Codex 用户可以先预览，再显式安装；安装过程不访问网络：

```shell
pnpm exec openapi skills install \
  --host codex \
  --scope project \
  --dry-run

pnpm exec openapi skills install \
  --host codex \
  --scope project
```

当前支持的 installer Host 只有 `codex`，且必须显式选择 scope：`project` 写入执行命令时的 `$CWD/.agents/skills`，`user` 写入当前用户的 `$HOME/.agents/skills`。它不会读取 `CODEX_HOME` 作为新 destination，不会覆盖已有 Skill directory，也不提供 force、update 或 uninstall。历史位置 `~/.codex/skills` 只会触发 bounded warning，不会自动迁移、移动或删除。安装后先新建 Codex chat/session；如果 Skills 仍未出现，再完整重启 Codex 并检查。

`skills install` 仍是 standalone Skill management/advanced entry；它不会配置 MCP。`openapi init` 仍只负责 generation config 和 ignore。新建 session 后使用 `openapi-to-setup` 检查实际 project Host capability；必须以实际 runtime evidence 判断结果。

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
```

安全边界是 local stdio、trusted project config 和 Core-validated generation intent。配置 `--config` 且省略 `--generation-mode` 使用 Developer default：统一 `openapi_generate` 按用户意图支持 write 或 dry-run。显式 `--generation-mode read-only` 保持八个 Tool 但只允许 dry-run；`--generation-mode hardened` 暴露十个 Tool，持久化写入必须经过 Prepare、exact approval 和 Apply。MCP 的 exact Tool matrix 和 capability boundary 见 [Capability matrix](docs/capability-matrix.md)。

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

aggregate package 额外 re-export 七个官方 plugin factories：

| Factory | 用途 | 状态 |
| --- | --- | --- |
| `pluginTSType` | TypeScript types | `Stable` |
| `pluginTSRequest` | TypeScript request client | `Stable` |
| `pluginZod` | Zod 4 schemas | `Stable` |
| `pluginSWR` | SWR hooks | `Stable` |
| `pluginVueQuery` | Vue Query hooks | `Stable` |
| `pluginReactQuery` | TanStack Query v5 primitives | `Stable` |
| `pluginMSW` | Mock Service Worker handlers | `Stable` |

Faker 和 NestJS generator 没有官方 package、aggregate export 或 published runtime。React Query capability 已通过 dependent packed React consumer evidence（Issue #117）提升为 Stable；consumer 仍需显式提供 React 与 TanStack Query v5。完整范围、OpenAPI dialect 边界和 MCP Tool 状态以 [Capability matrix](docs/capability-matrix.md) 为准。

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

`pluginTSRequest` 默认使用 Axios，也可以配置其他 request client。有效的 OpenAPI Header Parameter 与 Cookie Parameter 分别进入 `RequestInput.headers` 和 `RequestInput.cookies`；requiredness 由 OpenAPI contract 决定。Header 同名值按大小写不敏感比较，Cookie parameter name 则区分大小写。

Cookie 的显式 Header transport 默认关闭。关闭时省略 optional `cookies` 可照常请求；提供 Cookie 或调用包含 required Cookie 的 operation 会在 dispatch 前 fail closed。只有运行时或 request adapter 确实允许程序化设置 Cookie Header 时，才显式启用：

```ts
pluginTSRequest({ cookieTransport: 'header' })

await getSessionService({
  cookies: { session: 'test-session' },
})
```

该 opt-in 不代表浏览器前端可以设置 `Cookie` Header：Fetch/XHR 由 user agent 管理该 Header。本功能不会读取 `document.cookie`、创建 cookie jar、设置 `withCredentials` 或自动检测运行环境。浏览器 ambient cookies 由 request configuration/adapter 控制，且不满足 typed `input.cookies` contract。Header precedence 为 generated/system < `input.headers` < `input.cookies` 生成的 `Cookie` < `requestConfig.headers`；最终 `requestConfig.headers.Cookie` 会覆盖整个 Cookie Header。Cookie 值不会进入 React Query/Vue Query/SWR cache key 或 mutation variables。

Header transport 的序列化范围为有界子集：OpenAPI 3.0/3.1 的 `style: form` 仅接受无需 percent-encoding 的 primitive，数组和对象 fail closed；OpenAPI 3.2 的 `style: cookie` 支持 primitive、flat array 和 flat object，要求 `explode: true`，并以 `; ` 连接 Cookie pairs。不会自动 percent-encode、quote 或 escape；调用方必须预先提供合法 Cookie name/value。Parameter `content` 不支持。标准 Fetch transport 不包含在此功能中。

Header `Accept`、`Content-Type`、`Authorization` Parameter 按 OpenAPI 规范忽略；调用方仍可通过 `requestConfig.headers` 显式设置。Header `content` serialization 与 Common client 的自定义 Header 容器 fail closed；Common client 支持 plain object/record。

```ts
import type { AddPetMutationRequest } from './add-pet.types'
import { addPetService } from './add-pet.service'

const pet: AddPetMutationRequest = {
  name: 'Fido',
  photoUrls: [],
}

await addPetService({
  body: pet,
  headers: {
    'X-Request-Id': 'request-123',
  },
}, {
  headers: {
    'x-request-id': 'request-override',
  },
})
```

`pluginZod` 只支持 Zod 4：

```shell
pnpm add zod@^4
```

`oneOf` 使用 runtime `z.xor([...])` 并要求恰好一个分支匹配；`anyOf` 使用 `z.union([...])` 并要求至少一个分支匹配。`allOf` 生成 `z.intersection(...)`。不安全或不支持的组合会产生 structured diagnostic，而不是静默忽略。

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
pnpm mcp:inspect -- --generation-mode hardened
```

`mcp:inspect` 是 foreground、authenticated localhost 的人工检查入口，不是 CI gate，也不替代 stdio、controlled-write、recovery 或 performance tests。维护者的完整 release checks 见 [getting-started guide](docs/getting-started.md) 与 [Capability matrix](docs/capability-matrix.md)。
