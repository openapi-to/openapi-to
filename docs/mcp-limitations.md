# MCP limitations（MCP 限制）

- Transport 仅支持 stdio。Streamable HTTP、OAuth、API key 和 multi-tenancy 尚未实现。
- Trusted config 默认是 Developer mode：八个 Tool 中的 `openapi_generate` 可以在
  Workspace-confined、Core-validated transactional boundary 内直接持久化生成。
  Read-only mode 仍保持八个 Tool 但 generation 只 preview；Hardened mode 通过
  operator-enabled Prepare/Apply 提供 exact-plan approval boundary。任何 mode 都不
  提供 arbitrary path/content、OpenAPI/config edit 或 business API execution。
- Persistent selection 支持 single-target controlled Selective Prepare/Apply 的 additive 与 exact non-empty replacement。Prepare 无副作用；approved Apply 通过 Core three-state transaction 原子提交 projected artifact、safe managed deletion、ownership 和内部派生的 selection。Remove、clear、prune、operation-rename migration、historical full-output bootstrap、alternate destination 与 caller-selected cleanup policy 仍 unsupported。
- OpenAPI 3.2 支持 compatible-read，但存在已诊断的 generator gap，不是完整 generation support。
- Diff 是确定性的 first-stage ruleset，不是完整 compatibility proof 或 breaking-change oracle。
- Config 与 plugin 是 trusted、由 operator 选择的 executable code。Tool caller 不能改变它们；由于 load result 会缓存，修改后需要 Server restart。
- Operation catalog 是 trusted target 的 process-local snapshot。没有 watcher；修改 config 或 OpenAPI 后需 restart。Search 本身不会选择 code generation；selective Apply 会特意重新执行 trusted compilation，并只使用已冻结、已 review 的 operation key。
- Cancellation 是 cooperative。Remote I/O、compiler loop、plugin boundary、formatting、comparison 和 queue wait 会观察它；长时间同步 parser 或不配合的 plugin callback 无法在 instruction 中间安全中断。
- Progress 是 optional、coarse、仅标准 MCP progress。不提供 experimental Tasks 或 background job。
- Result 会有意截断，绝不包含完整 OpenAPI document、完整 `components.schemas`、无界 `$ref` expansion、完整 generated tree 或 binary Base64。
- Local TOCTOU check 会降低并检测重要 race，但不声称完全防护 hostile same-user process。
- 一个 controlled-write plan 恰好支持一个 configured target/output root，不声称具备 cross-root database-style atomicity。
- Plan token 证明 Server/Workspace/plan continuity，不证明 human 亲自点击了 approval；最终 confirmation policy 由 Host 负责。
- Filesystem transaction 使用 same-root staging、rename、fsync、rollback 和 recovery journal。断电与 network filesystem 仍有平台相关的 durability/atomicity risk。
- Controlled sidecar state 使用 journal v2 和 same-parent stage/backup。Output/state device mismatch 以 `SELECTIVE_STATE_CROSS_DEVICE_UNSUPPORTED` 失败；有意不提供 copy/delete fallback。
- Journal checksum 可检测 corruption，但不是持久 secret MAC；malicious same-user process 仍在 residual threat model 中，不安全的 recovery 会 fail closed。
- 不包含 telemetry、Resources、Prompts、Sampling、Elicitation、MCP Apps UI、LLM call 或 chat interface。
