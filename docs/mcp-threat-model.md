# MCP threat model（MCP 威胁模型）

受保护资产包括 Workspace confidentiality/integrity、stdio framing、model context budget、process availability 和 deterministic compiler result。OpenAPI document（包括 description、example、extension、URL 和 `$ref`）都是 untrusted data，绝不是 instruction 或 executable code。Startup config 与 installed plugin 是 operator 明确授权的 trusted executable project code；它们可以消耗 CPU/memory 并访问 operator 的 process authority，因此必须像 build script 一样 review。

| Threat（威胁） | Control（控制措施） | Residual risk（剩余风险） |
| --- | --- | --- |
| 路径 traversal、absolute path、symlink/case escape | MCP 与 transitive Core read 中的 resolve/realpath/relative/lstat boundary | 同一用户的 TOCTOU 无法完全消除 |
| 读取期间替换 file/config | opened handle 以及 pre/open/post identity check；发生变化时 fail closed | identity/mtime 语义较弱的 filesystem 会降低检测能力 |
| SSRF、redirect、DNS rebinding | 仅 HTTP(S)、host policy、validation 与 connection lookup 阶段拒绝 private/reserved IP，并限制 redirect/size/time | Operator 开启 private network 会有意降低隔离性 |
| 过大、过深或递归 input | source/response limit、cancellation checkpoint、cycle preservation、有界 synthetic pathological corpus | JSON/YAML parsing 本身是同步的，只能在 parsing 前后取消 |
| Context flooding | diagnostic/change/artifact/operation/text/preview limit、准确 totals 与稳定 truncation；不返回完整 document/binary | 配置的上限仍会消耗相应的 Host context |
| Document prose 中的 prompt injection | prose 不会被完整记录或返回，也不会被执行 | caller 明确请求 preview 时，仍可能收到有界 generated text |
| 恶意 trusted config/plugin | 仅 startup 固定 config；Tool 不能提供 code/plugin/env/shell | Trusted code 拥有正常 Node.js authority；不可信 project 应使用 OS isolation |
| Plugin console pollution | Bin 将 console log/info/debug 重定向到 stderr，但不替换直接 stdout write | 恶意 plugin 仍可故意写 `process.stdout`；仍需 review trusted plugin |
| 并发与 state leakage | call-local compiler state、per-instance generation queue、cancellation-safe release | Legacy third-party plugin 可能维护自己的 global state |
| Timeout/cancellation 泄漏 | invocation AbortSignal、可取消的 fetch/formatter/queue，以及 `finally` 中的 timer/listener cleanup | 不配合的同步 third-party plugin code 无法在进程内安全抢占 |
| Check 与 output/manifest 的 race | path check、stable file read 和 active-writer detection；不一致时失败而不是返回 current | 并发 external writer 仍可迫使安全失败 |
| Plan tampering、replay 或 full/selective 混淆 | per-Server random HMAC key、constant-time verification、plan kind/target/output/selection-owner/Workspace binding、TTL、exact approved hash、once-only consumption | Server 无法独立证明 human confirmation action |
| Cross-Server/Workspace token | random process nonce/secret 与 Workspace hash；plan 仅存在于 instance memory | Restart 会有意使未完成 plan 失效 |
| Stale config/source/ref/remote/selection/output | Apply 重新编译 trusted input，重新生成 frozen full 或 selective scope，并比较完整 projection/artifact/ownership 与 fresh content/identity snapshot；selection 在 lock 前及 lock 内检查 | 不配合的 trusted plugin 与 hostile same-user race 无法完全消除 |
| 意外覆盖 user file | Added path 必须仍不存在；modified path 必须匹配 prepared hash；不能使用 caller-supplied path/content/force | 最后一次 check 后的 same-user replacement 可能迫使失败/recovery |
| Managed deletion | exact Prepare deletion set、current ownership membership、regular non-linked file、unchanged hash | 损坏的 historical manifest 会安全失败，可能需要 recovery |
| 并发 CLI/MCP writer | shared per-output filesystem lock 与 lock 内 hash validation | Network filesystem 可能不提供本地 lock/rename 语义 |
| Commit 期间崩溃 | checksummed relative journal、same-device stage/backup、phase-aware startup recovery；journal v2 一起覆盖 generated artifact、ownership 与 controlled selection | Power-loss durability 取决于 OS/filesystem 的 fsync 与 rename guarantee |
| Rollback failure | byte/hash-verified reverse rollback 与 high-severity recovery-required diagnostic | 若 backup 或 root 被外部改变，可能需要人工恢复 |
| Lock 或 journal hijack | 拒绝 symlink/type/size/schema/root/hash/identity mismatch；绝不单独信任 PID/journal | Same-user attacker 仍可拒绝服务；journal checksum 不是 persistent MAC |
| Model 未经 approval 调用 Apply | 无 startup grant 时 Tool 不存在；Prepare/Apply 分离；exact token/hash；保守 annotation 与 Host approval guidance | Host policy 是最终 human-confirmation boundary |

本版本没有 HTTP listener、authentication、multi-tenancy、Tasks、background work、API execution、dynamic plugin injection、direct-write Tool、OpenAPI/config modification 或 arbitrary file-write surface。
