# Agent 与 Skills

根目录 `AGENTS.md` 给出协作和安全边界，目录内 `AGENTS.md` 增加更具体约束。`.agents/skills/` 是仓库 Skills 唯一的 authoritative source。

消费项目使用 `openapi-to-setup` 完成安装与运行时诊断，使用 `openapi-to-generate` 发现操作、生成客户端并集成结果。仓库开发按实际改动选择 CLI、MCP、plugin、codegen、OpenAPI 语义、依赖、CI 或 Release 专项 Skill；生成输出变化再使用 `run-codegen-tests`。Skills 不替代用户对远端写入、Merge、Settings 和 Release 的授权。
