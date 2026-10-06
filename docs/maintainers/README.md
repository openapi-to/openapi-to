# 维护者文档索引

`docs/maintainers/` 面向 openapi-to repository maintainer，集中提供维护流程和规范的入口。Repository Contract、root `AGENTS.md` 与适用的 Repository Skills 仍是权威来源；本索引只帮助定位文档，不新增治理政策或授权。

## 文档列表

| 文档 | 用途 |
| --- | --- |
| [autonomous-maintenance.md](./autonomous-maintenance.md) | 说明未来 autonomous maintenance 的治理边界、授权模型和当前状态。 |
| [chatgpt-codex-github-workflow.md](./chatgpt-codex-github-workflow.md) | 说明 ChatGPT、Codex、GitHub Issue/PR 与 CI 之间的协作和交接流程。 |
| [chatgpt-pr-review.md](./chatgpt-pr-review.md) | 说明网页 ChatGPT 如何独立审查 Pull Request。 |
| [documentation-language-audit.md](./documentation-language-audit.md) | 记录文档语言收敛审计的范围、结果和剩余边界。 |
| [documentation-language.md](./documentation-language.md) | 定义 repository 文档的 Chinese-first 语言规范。 |
| [parallel-development.md](./parallel-development.md) | 定义多任务并行开发、Issue lifecycle、交付证据和串行集成流程。 |

## 遇到这些问题时

| 问题 | 先看 |
| --- | --- |
| ChatGPT、Codex、GitHub Issue/PR 与 CI 如何协作？ | [ChatGPT/Codex/GitHub 协作工作流](./chatgpt-codex-github-workflow.md) |
| 网页 ChatGPT 如何独立 Review 一个 PR？ | [网页 ChatGPT PR Review 规则](./chatgpt-pr-review.md) |
| 多个 Issue 如何并行推进，状态如何流转，何时集成？ | [并行开发工作流](./parallel-development.md) |
| autonomous maintenance 当前允许什么、未来如何治理？ | [Autonomous maintenance governance](./autonomous-maintenance.md) |
| 新增或修改文档时应使用什么语言？审计记录在哪里？ | [文档语言规范](./documentation-language.md)；[语言收敛审计](./documentation-language-audit.md) |
