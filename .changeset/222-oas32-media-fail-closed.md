---
"@openapi-to/core": patch
"@openapi-to/plugin-ts-type": patch
"@openapi-to/plugin-zod": patch
"@openapi-to/plugin-ts-request": patch
"@openapi-to/plugin-msw": patch
"@openapi-to/plugin-vue-query": patch
"@openapi-to/plugin-swr": patch
---

对 OpenAPI 3.2 的 sequential JSON、SSE、`itemSchema` 与 positional multipart media 建立有界生成契约：Core 提供可复用 media 的本地引用检查，并退役已由插件明确处理的通用 media gap warning；TypeScript/Zod 保留 schema-only 的完整内容表示，对 item-level 语义分别生成 `never`/`z.never()` 与 error，包括有效 querystring Parameter 的 media；Request/MSW 对缺少 wire codec 的 media 在 artifact 创建前报错。React Query、Vue Query 和 SWR 在 Request 未生成 service 时跳过对应 hook。
