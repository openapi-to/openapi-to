# Projected OpenAPI compilation 与 selective dry-run

Phase 2A 增加 in-memory generation scope，用于预览一个或多个 operation。Phase 2 B2b 在受控的 Selective Prepare/Apply 中复用该 projection，同时保持 Prepare 无副作用，且不改变默认 full-target generation path。参见 [persistent operation selection](./persistent-operation-selection.md)。

```text
startup-trusted target
  -> process-local cached OpenAPICompilation + Operation Catalog
  -> exact operationKey selection
  -> component reference graph and closure
  -> projected OpenAPICompilation
  -> existing PluginManager and generators
  -> bounded GeneratedArtifact summaries
  -> MCP dry-run only
```

`GenerationScope` 有两种形式。省略 scope 或使用 `{ type: 'full' }` 保持既有 full generation 行为。`{ type: 'operations', operationKeys: [...] }` 会去重并排序 exact key；MCP Tool 只允许一个 trusted target，generation 过程中绝不执行 fuzzy search。Search fallback key 仍是有效 catalog identity，但 selective generation 会阻止 `operationId` 缺失或重复的 operation，因为当前 generator 使用 `operationId` 生成稳定 public name。

包含 standard HTTP operation 的 OpenAPI 3.2 文档可以通过现有 compatible-read adapter 进行 projection。3.2 的 `query` method 和 `additionalOperations` 仍是已诊断的 generation gap；选中它们会返回 `SELECTIVE_GENERATION_UNSUPPORTED_OPERATION`，而不会静默生成空的 operation artifact。

## Projection rules

Projected document 保留 OpenAPI version、`info`、相关 root server 与 extension；当选中 operation 未覆盖 root security 时也保留继承的 root security；同时保留 selected tags、selected paths/methods、path-level parameters/metadata 和 selected operation object。同一路径的其他 method 会被移除。

Core 为命名的 `schemas`、`parameters`、`requestBodies`、`responses`、`headers`、`securitySchemes`、`callbacks`、`links` 和 `examples` 构建显式 graph。通用 object traversal 覆盖 `$ref`、Schema composition，以及 properties、items、prefixItems、allOf/oneOf/anyOf/not、additionalProperties、contains、dependentSchemas、propertyNames 和 discriminator mapping 等 container keyword。Operation root 还会加入继承的 security scheme name。通过 visited/active traversal 计算 transitive component closure，保留命名的 local `$ref`，并在不 inline 完整 graph 的情况下终止 cycle。

Projection 从不加载 source。非 local reference 只能从 cached compilation 中已 resolve 的 node 替换。如果 compiled value 无法复用，projection 会返回 structured reference diagnostic，而不是 fetch 或返回 partial document。Projected compilation 保留 source identity、reference snapshot、compiler diagnostic 和 version metadata，同时将 `document`、`resolvedDocument`、`normalizedDocument` 替换为 projected form。

`projectionHash` 是 projection format version、target identity、root source content hash、OpenAPI version、sorted operation key 和 normalized projected document 的 SHA-256。它排除 path、process ID、time 和 randomness。Target compilation 缓存于 MCP Server lifetime；projection 按 request 重新计算，不使用 disk 或 process-level projection cache。

## Artifact 粒度

Projection 是统一的 selection boundary；plugin 不会收到独立的 selection branch。

| Plugin | Operation | Tag | Component/schema | Global |
| --- | --- | --- | --- | --- |
| TypeScript types | one operation file | none | schemas, parameters, request bodies, responses | enum model |
| TypeScript request/client | one operation file | none | consumes type metadata | none |
| SWR | one operation file | none | consumes operation/type metadata | none |
| Vue Query | one operation file | none | consumes operation/type metadata | none |
| Zod | one operation file | none | schemas, parameters, request bodies, responses | none |
| MSW | one operation file | none | consumes operation/type metadata | none |

React Query 与 Vue Query、SWR 一样生成 operation-local 文件，没有 generated index/barrel plugin。因此 operation file 自然跟随 selected operation set，component file 跟随 reference closure，TypeScript enum model 则从 projected document 重建。Plugin build state 仍限定在 invocation；`OperationAccessor` 现在按 operation object identity 使用 `WeakMap` 缓存，避免不同 target 中相同 method/path pair 共享 metadata。

## MCP workflow and safety boundary

```text
User asks for a user-detail page
  -> openapi_search_operations(target="backend", query="user detail")
  -> openapi_get_operation(target="backend", operationKey="getUserDetail")
  -> openapi_generate_dry_run(
       targets=["backend"],
       scope={ type: "operations", operationKeys: ["getUserDetail"] }
     )
  -> bounded projection statistics and artifact summaries
  -> Phase 2A ends without writing files
```

Selective dry-run 只使用 startup-trusted config、plugins、targets、Workspace、remote policy 和 output root。它不接受 source、config path、plugin、output path、content、clean/delete policy 或 write authority；不会创建 plan、获取 write lock、更新 ownership manifest、stage file，也不会调用 Prepare/Apply。Artifact count 与 preview 仍受既有 MCP limits 约束，既不返回 projected document，也不返回完整 component。

Persistent selection 使用该 projection 执行 additive union 和 exact non-empty replacement。Selective Prepare 绑定完整 desired projection 且不写入；明确批准后，Selective Apply 重新生成 frozen projection，并以原子方式提交 selected artifact、safe managed deletion、ownership 和 selection。
