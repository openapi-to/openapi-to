---
"@openapi-to/core": minor
"@openapi-to/mcp": minor
"@openapi-to/plugin-msw": minor
"@openapi-to/plugin-react-query": minor
"@openapi-to/plugin-swr": minor
"@openapi-to/plugin-ts-request": minor
"@openapi-to/plugin-ts-type": minor
"@openapi-to/plugin-vue-query": minor
"@openapi-to/plugin-zod": minor
---

支持 OpenAPI 3.2 fixed `QUERY` 与 `additionalOperations` 的统一 operation 发现、catalog、inspect、diff、projection 与生成。TypeScript types、Zod 和 request plugin 保留 custom method 的精确 wire casing；React Query、Vue Query 和 SWR 生成包含 body/query 的 `QUERY` cache key，不能精确表达的 query/MSW methods 以 structured diagnostics fail closed。
