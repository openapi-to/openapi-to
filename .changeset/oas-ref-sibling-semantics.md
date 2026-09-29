---
"@openapi-to/core": minor
"@openapi-to/plugin-zod": patch
---

修正 OAS 3.0 与 3.1/3.2 的 Schema `$ref` sibling 语义：忽略 3.0 Reference Object siblings，并保留 3.1/3.2 Schema Object 中当前支持的 sibling validation。
