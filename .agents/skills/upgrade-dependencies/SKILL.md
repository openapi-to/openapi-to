---
name: upgrade-dependencies
description: Use when evaluating or implementing openapi-to scoped dependency upgrades, dependency modernization, security patches, Renovate dependency PRs, or compatibility holds. Domain support for implement-and-review; not for ordinary features, release publication, generic CI repair, unrelated OpenAPI semantics, blindly updating every dependency to registry latest, automatic Merge, or Publish.
---

# 升级依赖（Upgrade dependencies）

本 Skill 只负责依赖事实、候选版本、兼容性、所有权、lockfile、验证选择和升级决定。
普通实施的 Primary 始终是 `implement-and-review`；Issue、完整 diff、独立 Review、
Ordinary Delivery 和 CI handoff 沿用其流程。本 Skill 不授予写入、Merge 或 Release
权限。当前 manifest、`pnpm-workspace.yaml`、`renovate.json`、
`.github/dependabot.yml`、`.changeset/config.json` 与 CI 才是当次政策依据。

## 1. 建立有来源的 Dependency Fact

在改 manifest、catalog 或 lockfile 前，记录每个候选的：

| 事实 | 要核对的内容 |
| --- | --- |
| 身份与角色 | package 名；direct、peer 或 transitive；runtime、dev、build、test 或 toolchain；使用它的 workspace packages 和实际 call sites。 |
| 当前状态 | owning manifest/catalog、declared version/range、lockfile 中每个相关 locked version 与 dependency closure。 |
| 候选状态 | wanted version、registry latest **stable** version、相关 dist-tag、publish timestamp、当前 release-age eligibility、deprecated 状态。 |
| 兼容性 | Node engine、package-manager 要求、peer/optional dependencies、支持的平台、官方 release notes/changelog；major 还需 migration guide、removed API 与 default behavior。 |
| 安全与供应链 | 相关 upstream/GHSA/CVE primary advisory、registry provenance、install/build scripts、native binaries、optional 与新增 transitive packages。 |

区分事实来源、已验证结论和未知项。`pnpm outdated` 可帮助发现候选，却不是升级
决定；`registry latest` 也不等于 repository-supported stable。Patch/minor 至少检查
官方发布说明、changelog 或 package metadata 的 breaking/deprecation 信息；major
必须核对官方 migration/breaking guidance、runtime/peer 要求、移除 API 和默认值变化。
测试通过不能代替 major 兼容性分析。

按 `PATCH`、`MINOR`、`MAJOR`、`SECURITY`、`TOOLCHAIN`、`RUNTIME`、`DEV_ONLY`、
`PEER`、`TRANSITIVE` 标注适用类别；SemVer 级别不是风险等级。`0.x`、compiler/parser、
MCP SDK、Zod、TypeScript、Node、pnpm、build system 及 filesystem/security 依赖，
即使是 patch/minor 也要按实际影响判断。

## 2. 确定所有权与可审查范围

先定位谁拥有版本：当前若使用 pnpm `catalog` / named `catalogs`，版本属于
`pnpm-workspace.yaml`；引用 `catalog:` 的 manifests 不应展开成重复 range。保持
`workspace:*`、alias、exact runtime pin、peer-compatible range 与 toolchain bridge
各自的 contract，例如当前的 `zod-exact` 与 `zod-peer` 不能为了表面统一而合并。
Transitive 问题先查实际引入路径和可升级的 direct owner，不默认添加无关 override。

默认每个依赖升级是独立可 review 的 unit，major 默认分开。只有官方 lockstep、
peer constraint、同一 package family 无法独立解析或其他已验证紧耦合关系，才把
多个依赖放在同一 Task；记录理由。Security 优先级不能扩张无关范围。Node baseline、
`pnpm` major、compiler 或 toolchain 架构或多包 public API migration 通常需要单独 Task。

Renovate 负责发现版本并提出 candidate PR；本 Skill 负责验证 candidate 对仓库的
适配、必要兼容修复和证据。读取当前 `renovate.json` 的 grouping、holds、
`minimumReleaseAge`、vulnerability exception 与 catalog range strategy；GitHub
Actions automation 看当前 Dependabot 配置。除非 Issue 明确包含 policy change，
不要顺手调整 automerge、grouping、PR limit、release age 或 vulnerability policy。

## 3. 兼容性、安全与候选决定

将 candidate 的 publish timestamp 与当前 pnpm / Renovate release-age policy 对照。
未达门槛时不绕过限制追逐最新；安全 exception 仅在 current policy 确实适用且
有证据时使用，不加入宽泛 `minimumReleaseAgeExclude: ["*"]`。核查 deprecation、
provenance、install scripts、native binaries、optional 和意外的 transitive 变化。

Security-driven task 要从 upstream advisory、GitHub Advisory、npm metadata 或
GHSA/CVE primary record 核对 affected range、fixed version、当前 lockfile 是否含
受影响路径，以及 runtime reachability 与 dev-only/transitive 属性。不能从漏洞标题
直接推导修复范围。只有 Host、network 和 repository policy 允许发送 dependency
graph 时才运行 `pnpm audit`；未执行则报告 `SKIPPED / UNVERIFIED`，不得声称
security `PASS`。

每个候选最终给出一个明确决定：

| 决定 | 必要证据 |
| --- | --- |
| `UPGRADED` | authoritative candidate、兼容性、精确 manifest/catalog 和 lockfile 效果、验证结果。 |
| `VERIFIED HOLD` | 当前/候选版本、具体不兼容点与来源、为何当前不可接受、未来解除条件；不能仅因实施麻烦而 Hold。 |
| `BLOCKED` | 缺失的关键事实或外部 blocker、获取事实或解除 blocker 的条件。 |
| `NEEDS SEPARATE TASK` | 超出本次可安全审查范围的 migration，以及应拆出的具体工作。 |

Hold 的真实原因可能是 Node/pnpm floor、peer conflict、unsupported runtime、
public API 或 generated-output regression、上游缺陷、release age 或平台问题。
不把 dependency 的 theoretical support 写成仓库已验证 support。

## 4. 修改与 lockfile 审查

尽可能先证明 baseline dependency state 可解析。先核对 root `packageManager`、
Node engines、scripts 和本机可用 runtime/pnpm；若需下载或切换工具，按 root
Host capability 规则先检查本机能力。只改 owning metadata 与必需兼容代码，
用当前仓库的 pnpm 正常生成 `pnpm-lock.yaml`。不得手工改 lockfile，也不得把
删除 lockfile 后重新 `pnpm install` 或无范围的 `pnpm update --latest -r`
作为 scoped Task 的解决方法。

阅读完整相关 lockfile diff：importer、目标 direct version、transitive closure、
peer resolutions、snapshots、optional/native packages、旧版本是否移除、重复版本和
无关 churn。任何无法解释的 churn 必须先定位原因，不能为缩小 diff 手工修剪。
完成后按当前 scripts 和 pnpm 能力选择 `pnpm install --frozen-lockfile`、
`pnpm verify:dependency-catalogs`、`pnpm verify:repository-contract` 等适用检查；
命令不存在或未运行时明确标 `SKIPPED`。

## 5. 按影响选择验证

选最窄且足以覆盖变更影响的检查，不机械运行全套；命令先在当前 manifests 核实。

| 影响 | 应考虑的证据 |
| --- | --- |
| Dev-only / repository tooling | owning tool smoke、受影响 lint/test、repository contract、必要的平台检查。 |
| Published runtime | 受影响 package tests/typecheck/build、consumer 行为与 package surface；published runtime 改动考虑 pack/install。 |
| Compiler / parser | Core、semantic fixtures、受影响 plugins、codegen、consumer smoke 与 deterministic second generation。 |
| MCP dependency | 按实际影响选 unit/integration/stdio、controlled write/recovery、Doctor、Inspector、E2E。 |
| Build / toolchain | build/typecheck/tests、平台、package surface、release smoke 与真实 packed consumer；Node、pnpm、TypeScript 或 module tooling 要核对 CI 环境。 |

特别检查 Node engine floor、pnpm engine/lockfile format、TypeScript compiler 与
declarations、module resolution、exports、build output、MCP Tool Schema 和 OpenAPI
semantics。真实列表以当次依赖图为准，不因 patch/minor 降低验证。

语义变化调用 `upgrade-openapi-support`；generated output 变化使用
`run-codegen-tests`，若有 owning generator defect 再用 `fix-codegen-regression`。
MCP Tool/schema 或 Prepare/Apply writer 的实际改动分别加载 `add-mcp-tool` 或
`add-mcp-write-tool`。既有 Remote CI 故障的 root cause 交给
`fix-github-actions`。`release-monorepo` 只处理真正的 release preparation，
不接管普通 dependency implementation。

每次明确 `Changeset: REQUIRED` 或 `Changeset: NOT REQUIRED — <reason>`。
依据 current release policy 判断 published runtime、consumer、generated output、
bug/security fix 与 internal-only toolchain 的实际影响；既不能机械认为
dependency-only 不需要 Changeset，也不能为每个 bump 机械添加。

## 6. Dependency-specific 交付记录

在主流程报告中附上紧凑证据：

- **Decision**：dependency、role、declared/locked、candidate、registry latest、
  dist-tag、publish date、release-age status、分类与四种决定之一。
- **Compatibility**：Node、pnpm、peer/optional、runtime/API、migration、security
  证据与尚未验证的边界。
- **Graph**：direct/transitive、owning catalog/manifest、受影响 workspaces、
  lockfile closure 和 unexpected churn 的解释。
- **Validation**：逐项写 `<exact command> — PASS / FAIL / SKIPPED`；区分 local
  与 exact-head Remote CI。
- **Changeset / Remaining risks**：决定和理由、剩余风险及解除 Hold/Blocker 条件。

没有当前证据时，不声称所有依赖安全、latest 兼容、漏洞已修复或 CI 通过。
