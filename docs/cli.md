# CLI generation guide

`openapi` 和 `openapi-to` 是同一个 CLI entrypoint 的 aliases，共用 Core compiler、Target selector、output resolver、artifact comparison、ownership writer 和 output lock。MCP 是额外的 entrypoint，不会替代手动 CLI。

## Target

`Target` 是一个稳定、独立生成的边界，包含一个 OpenAPI input、一个 output root 和一个 ownership manifest。`Operation` 是 Target 内的 endpoint。不同 Target 可以拥有相同的 `operationId`、path、tag 或 Schema name。

```ts
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
      name: 'legacy-service',
      input: { path: './openapi/legacy.yml' },
      output: { dir: 'legacy' },
    },
  ],
})
```

Name 必须非空、规范化且唯一。未命名的 legacy entries 会继续使用 `server1`、`server2` 等名称；对于 microservices，建议显式命名，因为 target selection、catalog identity、diagnostics、plans、selection state 和 ownership 都绑定到 name。

如果一个 service 提供多个 document，请配置多个 Target，例如 `user-public`、`user-admin` 和 `user-internal`。CLI 不会 scan、glob、merge 或动态 aggregate documents。

## Commands

```sh
# 生成所有已配置的 Target
openapi generate

# 生成一个 Target
openapi generate --target user-service

# 按 configuration order 生成两个 Target
openapi generate \
  --target user-service \
  --target order-service

# 预览选中的 Target，不写文件
openapi generate \
  --target user-service \
  --dry-run \
  --json

# 只检查选中的 Target
openapi generate \
  --target payment-service \
  --check \
  --json

# 显式选择一个 configuration file
openapi generate --config ./openapi.config.mjs
```

重复的 Target name 会去重。未知 name（包括 valid 和 unknown name 混合）会在 generation 写入前失败。未选择的 Target 不会被生成、clean 或 check，也不会影响 check exit code。Output order 遵循 configuration order。

不指定 `--config` 时，generation 从当前 directory 向上查找包含 `openapi.config.ts`、`.js`、`.cjs` 或 `.mjs` 的最近 directory。如果该 directory 有多个 supported candidate，会在执行任一文件前以 `OPENAPI_CONFIG_AMBIGUOUS` 失败。`.openapi-to` 或旧 state directory 下的文件不会被 auto-discover。选中的 configuration directory 就是 generation Workspace，包括 nested directory invocation 和 explicit `--config` path。

写入前，Core 会验证所有 configured Target names 和 output roots、每个 requested name，并编译所有 selected inputs。这可以避免后面的 invalid input 或 output 只在前一个 Target 已写入后才暴露。进入 plugin execution 和 commit 后，每个 Target 有独立的 ownership/transaction boundary；multi-Target CLI generation 不承诺跨 output roots 的 global rollback。

## Inputs

`input.path` 接受 Workspace-confined local JSON、YAML、YML files 和 HTTP(S) URLs。解析顺序会考虑实际内容、Content-Type，再考虑 extension；因此 extensionless URL、query-bearing URL、从 YAML-looking URL 返回的 JSON、以 `text/plain` 返回的 YAML，以及 external remote `$ref` document 都使用同一 loader。

Remote protocol 只有 `http:` 和 `https:`。Remote loading 使用 bounded redirects、逐 hop 的 protocol/host/private-network checks、connection-time DNS checks、timeout、decompressed response-size limit、cancellation、status diagnostics 和 URL credential/query redaction。Authentication headers、tokens、cookies 和 output paths 不是 CLI/MCP per-call arguments；已有 remote settings 位于 trusted project/server configuration 中。

## Output bases 与 ownership

```ts
output: {
  dir: 'generated',
}
```

等价于：

```ts
output: {
  base: 'managed',
  dir: 'generated',
}
```

并解析为 `.openapi-to/generated`。`base: 'workspace'` 会把 `dir` 解析到 Workspace 下，例如 `src/api/generated/user-service`。两种模式都由 generator 管理，并在 resolved output root 中放置 `.openapi-to-manifest.json`；Operation selection 保存在 `.openapi-to/selections`。

Workspace output 适合 project imports，也可以提交到 Git，但不属于 user-owned files：后续 generation 可能更新或删除 owned files。手写扩展请放在单独 directory，例如 `src/api/custom`。Output root 不能是 Workspace root、root `.openapi-to` state directory 的任何部分、`.git`、`node_modules`、escaping/symlinked path，也不能与其他 Target output 相同或形成 parent/child 关系。

把已有 Target 从 managed output 切换为 workspace output 不会迁移或删除旧 directory。请先生成并验证新 output，再按需要手动清理旧的 `.openapi-to` output。
