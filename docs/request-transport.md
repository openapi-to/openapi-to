# Request transport、Cookie 与 Header 参考

本页适用于 V4 candidate 的 `pluginTSRequest`。完整支持状态见 [Capability matrix](./capability-matrix.md)。

`pluginTSRequest` 默认使用 Axios，也可以配置其他 request client。有效的 OpenAPI Header Parameter 与 Cookie Parameter 分别进入 `RequestInput.headers` 和 `RequestInput.cookies`；requiredness 由 OpenAPI contract 决定。Header 同名值按大小写不敏感比较，Cookie parameter name 则区分大小写。

Cookie 的显式 Header transport 默认关闭。关闭时省略 optional `cookies` 可照常请求；提供 Cookie 或调用包含 required Cookie 的 operation 会在 dispatch 前 fail closed。只有运行时或 request adapter 确实允许程序化设置 Cookie Header 时，才显式启用：

```ts
pluginTSRequest({ cookieTransport: 'header' })

await getSessionService({
  cookies: { session: 'test-session' },
})
```

该 opt-in 不代表浏览器前端可以设置 `Cookie` Header：Fetch/XHR 由 user agent 管理该 Header。本功能不会读取 `document.cookie`、创建 cookie jar、设置 `withCredentials` 或自动检测运行环境。浏览器 ambient cookies 由 request configuration/adapter 控制，且不满足 typed `input.cookies` contract。Header precedence 为 generated/system < `input.headers` < `input.cookies` 生成的 `Cookie` < `requestConfig.headers`；最终 `requestConfig.headers.Cookie` 会覆盖整个 Cookie Header。Cookie 值不会进入 React Query/Vue Query/SWR cache key 或 mutation variables。

Header transport 的序列化范围为有界子集：OpenAPI 3.0/3.1 的 `style: form` 仅接受无需 percent-encoding 的 primitive，数组和对象 fail closed；OpenAPI 3.2 的 `style: cookie` 支持 primitive、flat array 和 flat object，要求 `explode: true`，并以 `; ` 连接 Cookie pairs。不会自动 percent-encode、quote 或 escape；调用方必须预先提供合法 Cookie name/value。Parameter `content` 不支持。标准 Fetch transport 不包含在此功能中。

Header `Accept`、`Content-Type`、`Authorization` Parameter 按 OpenAPI 规范忽略；调用方仍可通过 `requestConfig.headers` 显式设置。Header `content` serialization 与 Common client 的自定义 Header 容器 fail closed；Common client 支持 plain object/record。

```ts
import type { AddPetMutationRequest } from './add-pet.types'
import { addPetService } from './add-pet.service'

const pet: AddPetMutationRequest = {
  name: 'Fido',
  photoUrls: [],
}

await addPetService({
  body: pet,
  headers: {
    'X-Request-Id': 'request-123',
  },
}, {
  headers: {
    'x-request-id': 'request-override',
  },
})
```
