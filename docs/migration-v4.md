# 迁移到 openapi-to 4

Version 4 将 compiler、CLI、official plugins 和 MCP runtime 合并到同一条 release line。
第一个 release candidate 是 `4.0.0-rc.0`，用于迁移测试，不能当作稳定的 4.0 release。

## 安装入口

大多数项目只需要 aggregate package：

```sh
pnpm add -D openapi-to
```

该安装提供三个命令：

```text
openapi
openapi-to
openapi-to-mcp
```

`openapi` 和 `openapi-to` 是同一个 CLI 的 aliases。`openapi-to-mcp` 启动 stdio MCP
server。高级集成仍可以单独安装 MCP package：

```sh
pnpm add -D @openapi-to/mcp
```

独立 package 提供 `openapi-to-mcp` command、`@openapi-to/mcp` server API 和
`@openapi-to/mcp/cli` runner。`openapi-to` 有意不从顶层 JavaScript API re-export MCP
server implementation APIs。

## 配置 microservice targets

`Target` 是一个独立的 OpenAPI input 和 generation boundary。不同 microservice 应配置
不同的 Target。如果一个 service 有多个必须保持独立的 documents，应为每个 document
配置一个 Target。

Target names 在 CLI 和 MCP operation catalog 中保持一致。要生成选中的 services，可以
重复使用 `--target`：

```sh
openapi generate --target user-service
openapi generate \
  --target user-service \
  --target order-service
```

省略 `--target` 会继续生成所有已配置的 Targets。Selection 以 Target 为边界，因此
不同 services 中相同的 operation IDs 或 schema names 不会冲突。

## 手动迁移 configuration 和 state

Version 4 明确了 configuration 和 state boundaries：

| Before | After |
| --- | --- |
| `.OpenAPI/openapi.config.*` | `./openapi.config.*` |
| `.OpenAPI/` | `.openapi-to/` |
| `folderName` | `stateDirectoryName` |

将一个 configuration file 移动到 Workspace root，并命名为 `openapi.config.ts`、`.js`、
`.cjs` 或 `.mjs`。Version 4 不会自动读取、复制或迁移旧 configuration，也不会复制旧
selection、清理旧 directory 或删除旧 managed output。

如果必须保留 selection 或其他 state，请先检查它，只迁移对新的 configuration 和
output identities 仍然有效的 state。安全顺序是：生成到 `.openapi-to`，验证新的 result
和 ownership manifest；确认旧 state 与 managed output 不再需要后，再手动删除旧 directory。
不存在兼容性 fallback，也不会自动执行 `.OpenAPI` 到 `.openapi-to` 的迁移。

## 选择 output base

默认 output 为 managed：

```text
managed -> .openapi-to/<output.dir>
```

显式的 Workspace output 会把 generated directory 放在配置的 Workspace 下：

```text
workspace -> <workspace>/<output.dir>
```

两种模式都由 generator 管理。writer 会限制 paths、拒绝互相重叠的 Target roots，并在
`.openapi-to-manifest.json` 中记录 owned files。Cleanup 只考虑此前 ownership manifest
记录的 files；首次运行不会清理 unmanaged files。

## 检查 remote-input policy

Input 可以是本地 JSON、YAML 或 YML files，也可以是 HTTP(S) documents。Remote access 使用 Node 原生 fetch：

- explicit HTTP(S) root URL 是 caller 授权目标，包括 localhost/private network；
- same-origin `$ref` / redirect 自动允许，cross-origin derived request 需额外 `allowedHosts`；
- local root 的 remote `$ref` 同样需 `allowedHosts`；
- 不再进行 DNS/IP/private-address classification 或 DNS rebinding defense；
- configured headers 只保留给 initial request 和 same-Origin redirects；
- cross-Origin redirects 会清除 configured headers；
- HTTPS-to-HTTP redirect downgrades 会被拒绝；
- timeout、redirect 和 response-size limits 始终有界。

MCP Tool arguments 不能新增 headers、修改 trusted configuration，或放宽 derived cross-origin network policy。

## 保持 paths 可移植

支持原生 Windows absolute input paths。Drive-relative paths 会被拒绝，因为其含义依赖
process state。UNC 和 `file:` configured inputs 也会被拒绝。

`output.dir` 必须使用在 Linux、macOS 和 Windows 上都能安全解析的 portable relative
segments。避免 absolute paths、`..`、drive 或 UNC prefixes、Windows reserved names，以及
仅大小写不同的 segments。Existing output roots、parents 和 managed targets 不得是 symlinks。

## 有意配置 MCP

不带 project configuration 时，stdio server 暴露三个 bounded analysis Tools：

```text
openapi_validate
openapi_inspect
openapi_diff
```

trusted Workspace-local `configPath` 会增加 Target listing、operation catalog/search/
contract、dry-run 和 check capabilities，共八个 Tools。该 configuration 是由 server operator
选定的可执行 trusted project code，并在 server lifetime 内缓存。提供 trusted config 和
operator-only `allow-write` grant 后，再增加现有的 Prepare/Apply pair，共十个 Tools：

```text
openapi_prepare_generation
openapi_apply_generation
```

Prepare 不写入任何内容。它返回 bounded review 和一个短时、一次性的 token；token 绑定
exact Target、inputs、output state、artifacts 和 plan hash。Apply 只接受 plan ID、token
和 approved hash；它会重新生成、拒绝 stale state，并通过共享的 lock/journal/rollback
transaction writer 提交。不存在 direct-write、`force` 或 stale-plan bypass。当前 boundary
是每个 plan 一个 Target 和一个 output root。

## 需要关注的 breaking changes

- 只有 root `openapi.config.*` files 会被自动发现，不再搜索旧 directory。
- Tool-managed state 和 managed outputs 改用 `.openapi-to`；现有 selections 和 generated
  output 不会自动复制或删除。
- Core export `stateDirectoryName`，不再 export `folderName`。
- 删除旧 `allowPrivateNetwork` 配置与 MCP `--allow-private-network`；explicit root 直接允许，`allowedHosts` 仅授权 derived cross-origin requests。
- Conflicting artifact paths 会确定性失败，不再依赖 plugin 或 filesystem write order；
  case-only collisions 在所有 platforms 都会失败。
- Managed cleanup 以 ownership manifest 为边界，不再把现有 output directory 整体视为
  generator-owned。
- CLI failures 使用分类后的 non-zero exit codes。假设所有 failure 返回同一个 code 的
  scripts 必须更新。
- Remote redirects 不再跨 origins 转发 configured headers，HTTPS-to-HTTP downgrades 会
  失败。
- Unsafe 或依赖 platform 的 configured paths 会在 validation 阶段失败，不再在不同
  operating systems 上以不同方式解释。

## 兼容性边界

OpenAPI 3.2 input 属于 compatible-read，并对 generation gaps 给出 diagnostics；本
release 不声称完整的 OpenAPI 3.2 support。Streamable HTTP MCP、cross-Target Apply、
operation-level CLI selective generation、automatic service discovery 和 OpenAPI document
merging 仍不在范围内。

MCP operating details 参见 [MCP operations](./mcp-operations.md)、[security boundary](./mcp-security.md)
和 [controlled-write recovery](./mcp-write-recovery.md)。
