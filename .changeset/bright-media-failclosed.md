---
"@openapi-to/core": patch
"@openapi-to/plugin-zod": patch
---

在 Core 中保留所有 Response media representation 的确定性 inventory，并拒绝违反 OAS cardinality 的多项 Parameter/Header content。Zod 对无 Content-Type 上下文的多媒体 RequestBody/Response 生成 `z.never()` 和 error diagnostic；对含歧义 status 的 success/error aggregate 整体 fail closed。
