---
"@openapi-to/core": minor
---

新增 OpenAPI 3.2 Media Type 语义分类器，保留完整 `schema` 与逐项 `itemSchema`，区分 by-name、positional 和规范忽略的 encoding 字段，并对互斥组合产生精确结构诊断。该 Core 能力不包含 streaming 或 multipart runtime codec。
