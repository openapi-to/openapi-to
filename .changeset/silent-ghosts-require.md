---
"@openapi-to/plugin-zod": patch
---

修复对象 Schema 的 `required` 存在性校验，使未在 `properties` 声明的名称也必须存在。
