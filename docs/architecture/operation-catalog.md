# Operation Catalog 与有界契约发现

Phase 1 为大型 OpenAPI 文档增加按需的 read-only operation discovery。本阶段不改变 generation、artifact ownership 或受控的 Prepare/Apply writer。

```text
startup-trusted target
  -> compile / resolve / normalize
  -> Operation Catalog
  -> lexical search
  -> one operation contract
  -> bounded MCP structured output
```

`@openapi-to/core` 基于一次已有的 compiler result 构建 catalog。Catalog entry 包含 stable identity、method/path、tags、有界文本、参数名、被引用的 request/response Schema 名、response property 名、deprecation 和 JSON Pointer；不会暴露 Operation Object 或完整文档。搜索是确定性的本地 lexical matching，不使用 embedding service、vector database 或网络依赖。

## Stable operation identity

在一个 target 内，非空且唯一的 `operationId` 就是 `operationKey`。缺失或重复的 `operationId` 会回退到规范化的 `METHOD + path`，例如 `GET /users/{id}`。Core 会发出 `MISSING_OPERATION_ID`、`DUPLICATE_OPERATION_ID` 和 `OPERATION_KEY_FALLBACK_USED`；使用回退 key 的 operation 仍可搜索。Target identity 不在 key 内，因此 registry 必须始终按 target 隔离 catalog。

## Two-stage MCP workflow

只有 operator 提供了 startup-trusted config，Catalog Tools 才会注册：

1. `openapi_list_targets` 发现安全的 target 名称和计数，但不暴露 source location、URL、header、environment value 或 config body。
2. `openapi_search_operations` 默认最多返回八个轻量 candidate；结果不包含 request/response Schema body。
3. `openapi_get_operation` 以 `summary` 或 `contract` detail 读取一个选定的 `operationKey`。

Example:

```text
User asks for a user-resource trend page
  -> openapi_search_operations(target="backend", query="用户资源趋势")
  -> AI compares the bounded candidates
  -> openapi_get_operation(target="backend", operationKey="getUserResourceTrend")
  -> AI confirms request and response shapes
  -> Phase 2A may pass the confirmed operationKey to selective dry-run
```

我们有意拒绝 one-interface-per-Tool：Tool metadata 会随文档增长、膨胀每次 model context，并把 operation identity 变化变成 protocol surface 变化。三个固定的 catalog Tool description 不会随 operation 数量增长。

## Contract and Schema limits

Core 默认值为 `schemaDepth=2`、`maxSchemas=20`、`maxPropertiesPerSchema=50`、`includeExamples=false`，contract budget 为 128 KiB。MCP search 默认八个 candidate，单次请求上限为 50；MCP 还会应用配置的 diagnostic 和 structured-result 总字节预算。`$ref`、object properties、required、arrays/items、enum、`allOf`、`oneOf`、`anyOf`、`additionalProperties`、nullable、discriminator 和 cycle 只在这些限制内摘要化；cycle 以 `circular` marker 终止。

触及限制时设置 `truncated=true`，加入稳定 reason，并报告 unresolved reference；不会静默截断。两个 Tool 都不会返回完整 OpenAPI document、完整 `components.schemas`、所有 operation detail 或无界的 dereference closure。

## Trusted target cache

MCP registry 扩展现有的 process-lifetime trusted-config state。Cache key 绑定 trusted config display identity、target name 和 configured source identity。并发的首次加载共享一个 Promise；失败的 compilation 会移除，以便后续调用重试，成功的 target 则保持隔离并缓存到 Server shutdown。没有 watcher 或 automatic refresh；修改 config 或 OpenAPI input 后必须重启 MCP Server。

## Phase boundary

Catalog 本身仍是 read-only discovery。Phase 2A 使用其 exact key 进行 [projected selective dry-run](./projected-compilation.md)，但不改变 search 或 contract result。Selection manifest、selective Prepare/Apply 和 generated-file write 不属于本阶段；默认 code generation 仍是 full-target generation。
