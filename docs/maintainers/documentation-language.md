# Repository 文档语言规范（Documentation Language Policy）

本文件是 openapi-to Repository 的唯一 canonical 文档语言规范。它约束新增和维护
文档时的语言选择，不是全仓翻译计划，也不改变代码、协议、工具或发布行为。

## 目标与基本原则

Repository 文档采用 **Chinese-first、not Chinese-only** 原则：

- 面向开发者和维护者的自然语言，默认使用简体中文。
- 英文可以在技术语义更准确、是上游原词、是读者熟悉的固定术语，或能避免歧义时保留。
- 语言选择服务于准确、稳定、可验证的技术沟通；不以“英文清零”为目标。
- 本规范建立规则，不要求在一次变更中翻译现有 README、Architecture、MCP、Security、
  package README、`.agents/skills/**` 或其他既有文档。

新增文档、被实质修改的文档和面向维护者的治理文本应遵守本规范。已有文档可以在自然
维护机会中逐步对齐；不应为了语言一致性批量改写无关内容。

## 默认使用简体中文的内容

以下内容通常使用简体中文：

- 说明目标、背景、限制、设计理由、使用场景和故障排查建议的自然语言；
- 面向开发者或维护者的段落、列表、表格说明和注释性文字；
- 文档标题，除非英文原词是不可替代的技术名称，或双语标题能明显提高检索和理解；
- 对当前实现边界、验证结果和后续工作的解释。

中文表达应优先保持原意和边界。无法确认的事实应明确写成未知或待验证，不得用更自然
的中文措辞掩盖不确定性。

## 必须保留原始英文的内容

下列内容是稳定标识符、协议数据或机器契约的一部分，必须保持原始拼写、大小写和标点，
不得为了中文化而改名：

- 代码、代码符号、import/export 名称、package 名和文件名；
- 命令、命令参数、路径、URL、环境变量和配置键；
- API、CLI、MCP Tool、Tool name、Schema 字段、JSON/YAML 字段和协议字段；
- `contract-id`、contract marker、`contract-field` 以及其他 machine-readable token；
- Git/GitHub 固定术语、上游 specification terminology 和需要精确复制的错误信息或命令
  输出；
- Agent Instructions、Skill frontmatter、Skill name、trigger keyword、authority
  terminology 和会影响行为的其他机器可读内容。

代码块中的代码、命令和命令输出按原样保留。代码块外可以用中文解释其含义，但不应把
示例中的标识符改写成中文版本。

实现直接绑定的 technical identifiers 也不机械翻译，例如：`Target`、`Workspace`、
`Operation`、`Prepare`、`Apply`、`planHash`。如果需要说明含义，可以写成“`Target`
（目标对象）”或在正文中提供中文解释，但实际 identifier 必须保持不变。

## 标题与双语写法

标题不要求全部双语。默认使用简体中文；在英文名称是稳定术语、常用检索词或能帮助
跨语言读者定位文档时，使用：

```text
快速开始（Getting Started）
```

双语标题中的英文应是该概念的真实名称，不应为了形式统一而给每个标题附加英文。正文
同样遵循 Chinese-first：双语标题不意味着全文必须逐句双语，也不意味着要翻译代码、
命令、协议字段或 upstream specification terminology。

## Markdown 文件路径与命名

Markdown 文件路径继续采用 Repository 现有的 English naming 和 kebab-case 约定。路径
是稳定链接、脚本输入和工具引用的一部分，因此：

- 不批量把 `getting-started.md` 等路径重命名为中文；
- 新文件应沿用所在目录既有的 English naming 约定；
- 标题和正文可以中文化，但不能借此改变现有链接、引用或机器输入。

## Capability 状态与技术术语

Capability、兼容性和治理文档中的状态值具有精确含义，保持英文原值，不用近义中文词
替换，也不因语言调整而改变状态：

| Stable value | 使用要求 |
| --- | --- |
| `Implemented` | 说明当前已有实现；仍需以代码、测试和配置核验边界。 |
| `Stable` | 说明当前稳定支持的能力或接口；不等于所有相关场景都支持。 |
| `Partial` | 说明仅覆盖明确边界的一部分能力；应同时说明未覆盖范围。 |
| `Experimental` | 说明能力存在但仍处于实验阶段；不能写成稳定承诺。 |
| `Planned` | 说明计划中的工作，不代表当前实现。 |
| `Proposed` | 说明提议中的方案，不代表已批准或已实现。 |
| `Not Supported` | 说明当前明确不支持；不能被弱化成“暂时不便”。 |
| `Unknown` | 说明当前没有足够证据判断；不能推断为支持或不支持。 |
| `Need Verification` | 说明必须补充核验后才能作出可靠结论。 |

这些值可以在中文句子或表格中出现，但其拼写、大小写和语义保持稳定。例如：“当前
状态为 `Partial`，仅覆盖……”。`Target`、`Workspace`、`Operation`、`Prepare`、
`Apply`、`planHash` 等 technical identifiers 同理：可以解释，不要机械改名。

## Agent Instructions 与 Skills 的特殊规则

Agent Instructions 和 Skills 不是普通散文。它们同时可能是人类可读的说明和 Agent
行为、路由、验证或权限边界的输入。因此，中文化时必须区分可翻译的说明文字和不可改动
的机器接口：

- YAML frontmatter、字段名、Skill name、trigger keyword 和 Tool name 保持原样；
- `contract-id`、`contract-field`、contract marker 和 machine-readable token 保持原样，
  且不得通过翻译、大小写变体或同义词制造第二份标识；
- schema field、CLI 参数、MCP Tool 名、协议值和 authority terminology 保持原样；
- 只翻译不会参与解析、匹配、路由、权限判断或测试断言的自然语言；
- 改动可能影响 behavior 的 Instructions 或 Skill 文本时，必须按相应 repository
  contract、测试和 Review 要求验证，不能把“只是翻译”当作行为中性证据。

本规范不要求翻译 `.agents/skills/**`。当后续任务确实修改 Skill 时，应同时检查其
frontmatter、触发描述、路由引用和 machine contract，遵守对应 Skill 的所有权与验证
规则。

## Source of Truth 与事实边界

语言规范不会提升事实等级。中文表述必须服从当前 Repository 的事实层级：

1. 代码、测试、配置和机器契约是实现行为与稳定接口的主要证据；
2. Issue、PR、Project 和验证报告只在其各自可核验范围内说明任务或状态；
3. 文档用于解释已核验事实和边界，不能把 stale documentation claim 升级成
   Implementation Fact。

代码、tests、config 或其他当前 repository rule 与旧文档冲突时，以当前规则和可验证的
实现事实为准，并把文档漂移作为后续修复范围判断。不要为了让中文文本看起来完整而补写
未经验证的 Capability、Runtime、Security 或 Release claim。

## 维护与范围边界

本规范是单一 canonical policy，不建立 `docs/en` 与 `docs/zh-CN` 两套 canonical docs。
后续文档工作应引用本文件，而不是在 README、AGENTS、Skills 或各个子文档中复制一份完整
语言政策。发现既有英文文档的事实错误时，除非该修复是当前任务建立语言规范所必需，
否则应作为 related follow-up 单独处理。

每次文档变更都应保持最小范围，并检查：

- 技术标识符、状态值、路径、链接和代码块是否保持可复制、可验证；
- 中文化是否误改了 Capability、Runtime、Security、Release 或 authority 事实；
- 是否意外扩大成全仓翻译、路径重命名、双语文档树或行为变更。
