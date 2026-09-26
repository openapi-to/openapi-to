---
"@openapi-to/core": minor
"@openapi-to/plugin-ts-type": minor
"@openapi-to/plugin-ts-request": minor
"@openapi-to/plugin-react-query": minor
"@openapi-to/plugin-vue-query": minor
"@openapi-to/plugin-swr": minor
---

在 4.0 RC 中将 generated request API 迁移为 `request(input, requestConfig?)`，统一使用仅包含 path/query/body 的 operation RequestInput；framework wrappers 在调用前组装相同输入。Core 统一 group requiredness，并按 Header case-insensitive identity 合并有效参数。已有独立 HeaderParams/CookieParams 保留，本次不实现 typed Header/Cookie transport 或 Fetch。
