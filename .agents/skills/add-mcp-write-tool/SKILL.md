---
name: add-mcp-write-tool
description: Extend or repair openapi-to's operator-gated MCP generation Prepare/Apply protocol, including plan binding, HMAC tokens, stale-state validation, transactional writing, locks, rollback, crash recovery, cancellation, stdio integration, Codex confirmation safety, and release coverage. Use for changes to openapi_prepare_generation, openapi_apply_generation, plan storage, or the shared transaction writer; never add another write Tool or broaden writable files without separately explicit user authorization.
---

# 扩展 MCP controlled write capability

本 Skill 仅用于现有两阶段 controlled generation writer。优先扩展 `openapi_prepare_generation` 和 `openapi_apply_generation`，绝不能另加 direct-write Tool、OpenAPI/config modification、caller-selected path/content/plugin、shell/business API execution、`force` 或 stale-plan bypass，除非用户另行明确授权。

编辑前读取 root `AGENTS.md`、`packages/core/AGENTS.md`、`packages/mcp/AGENTS.md`、`docs/architecture/mcp-controlled-write.md`、[controlled-write checklist](references/controlled-write-checklist.md)、`.agents/skills/add-mcp-tool/SKILL.md` 和 public package 变化时的 `.agents/skills/release-monorepo/SKILL.md`。

遵守 `packages/mcp/AGENTS.md` 中关于 registration matrix、Prepare/Apply authority、token/plan、
stale-state、transaction、cancellation 和 recovery 的长期约束。本 Skill 负责 change mapping、
test selection、security evaluation 和 stop/report decision，不重复定义 module rules。

## 建立 boundary

确认 clean committed baseline 并保留 user changes。把 exact change 映射到：

- `packages/mcp/src/tools/prepare-generation.ts` and `apply-generation.ts`;
- per-Server `generation/plan-store.ts` and `write-plan.ts`;
- Workspace/config/generation services and the generation queue;
- Core artifact comparison, transaction lock/writer/journal/recovery;
- CLI writes that must share the same output lock;
- official Client subprocess tests, Inspector/Codex safety evaluation, docs, Changeset, and package smoke.

保持 registration matrix：无 config 为 3 个 Tool，trusted config 为 8 个，trusted config 加 operator `allowWrite` 才能为 10 个。Tool arguments 永远不能启用 writes。每个 plan 仍只允许一个 target/output root；多 target 必须显式失败，不能部分 Apply。

## Change-specific review

追踪完整 internal plan 和 bounded external review result，列出新增的 input、identity、hash、
precondition、limit 和 lifecycle transition。对 Apply 标出 plan consumed 的 exact point、shared
lock 下重复的 checks，以及每个新 failure 的 rollback/recovery。

confirmation semantics 变化时同步审查 Tool descriptions 和 Codex evaluation cases。Server 证明
plan continuity，不证明 human identity；含糊的“generate/update/continue”仍必须 Prepare 或询问，不能 Apply。

## Required validation

只用 internal test failpoint，不把它暴露为 public Tool argument。覆盖所有 staging/backup/rename/delete/manifest/cleanup point，并比较完整 pre/post output bytes。crash recovery 使用真实 subprocess SIGKILL；覆盖 symlink/tampering、hard link、root replacement、token tamper/replay/expiry/cross-Server、stale-plan、cancellation、two Servers 和真实 CLI/MCP contention。

使用 stable SDK Client 与 stdio transport 针对 built binary 验证 Prepare、Apply、disk、replay、invalid input、timeout/cancellation、stderr redaction 和 stdout purity。更新 package-owned write/recovery layers、repository Doctor 和 Node 22/cross-platform CI。Inspector 不替代 internal failpoint、SIGKILL、journal、lock 或 commit-critical cancellation tests。需要时执行 Codex safety cases，并要求没有未经 explicit confirmation 的 Apply、plan guessing/replay 和 deletion disclosure。

然后运行 `pnpm test:mcp:write`、`pnpm test:mcp:recovery`、`pnpm test:mcp:all`、MCP Doctor、受影响 Core/MCP/CLI tests/typechecks/builds、formal second-run、root Vitest/typecheck/build、changed-file lint、release scripts、package surface、tarball smoke 和 Changeset status。检查 MCP tarball，不能包含 repository tests、Doctor/Inspector scripts、fixtures、journals、failpoints、tokens、benchmarks、logs、local config 或 machine paths。不得隐式 publish、commit、push 或 tag。

## Stop conditions

出现以下情况时停止并报告，不得弱化 controls：

- write 可绕过 Prepare、operator grant、exact token/hash 或 revalidation；
- stale plan 可被 force、静默 re-plan 或 apply 到新 output；
- unmanaged/changed/symlinked/linked file 可能被覆盖或删除；
- rollback/recovery 无法证明一致的 file-plus-manifest state；
- CLI 与 MCP 可并发写入同一 root；
- cancellation 留下 half-commit 或 stranded lock；
- stdout 非 protocol output，或 logs 暴露 token/content；
- 请求需要另一个 write Tool 或更宽 write target，但没有单独明确授权。
