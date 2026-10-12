# 维护工作流

网页 GPT 可协助撰写 Issue 和执行建议。维护者按任务选择 AO、Codex 或其他工具实施、验证并创建 PR，最后自行决定 Merge。Issue 描述目标、范围和验收；PR 说明实际变更、测试结果、关联 Issue 和剩余风险。

实施前核对当前 `main`、工作树和相关 PR，在独立分支完成改动。运行受影响测试并检查完整 diff；真实失败和未知状态应如实报告。GitHub Required CI 以当前 PR HEAD 的结果为准。Review 可由维护者根据变更风险和工具能力安排，不指定唯一 Reviewer 或额外 Host 证明。

Merge、Merge Queue、Auto-merge、Release、Publish、Tag、Ruleset、Secrets、Branch Protection、Settings 和 Project 修改仍由维护者明确授权。产品安全、MCP 写入、路径沙箱、日志脱敏和发布检查继续由代码、测试及现行 GitHub 规则约束。
