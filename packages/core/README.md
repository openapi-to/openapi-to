# @openapi-to/core

`@openapi-to/core` 是 `openapi-to` 的 compiler semantics authority，提供 compiler pipeline、diagnostics、generated artifacts、plugin runtime、inspection 和 first-stage diff APIs。

Core 读取 Swagger 2.0 和 OpenAPI 3.0/3.1。OpenAPI 3.2 支持 compatibility-read，并对 generator gaps 给出 diagnostics；这不代表完整的 3.2 generation support。

大多数用户应安装 aggregate package `openapi-to`。Plugin 和 tooling authors 可以直接 import Core；这不会把 CLI 或 MCP adapter semantics 下沉为 Core 自身能力。

Core 的 public exports 包括 `compileOpenAPI`、`resolveOpenAPIReferences`、`validateOpenAPIDocument`、`inspectOpenAPIDocument`、`diffOpenAPIDocuments`、diagnostics、`GeneratedArtifact` 以及 configuration/plugin APIs。请以源码和测试为准，不要把 package README 当作新的 capability contract。

参阅仓库的 [Capability matrix](../../docs/capability-matrix.md) 和 [快速开始](../../docs/getting-started.md)。
