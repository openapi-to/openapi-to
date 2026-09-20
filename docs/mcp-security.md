# MCP security boundary（MCP 安全边界）

`@openapi-to/mcp` 是面向一个 canonical Workspace 的 local stdio adapter。不提供 HTTP service、authentication service、SaaS boundary 或 model runtime。

## Startup authority

Server operator（不是 Tool caller）选择 Workspace、optional trusted config、remote-host policy、timeout、limit，以及是否存在 controlled write Tool。TypeScript/JavaScript config 是 executable trusted project code。Tool argument 不能替换 config、选择 plugin/package、改变 Workspace/output root、提供 arbitrary path/content 或放宽 remote-network policy。

无 config 时提供三个 analysis Tool；trusted config 增加五个 read-only catalog/generation-check Tool；`--allow-write` 要求 config，并且只增加 Prepare 与 Apply。

## Read-only means no writer

Validation、inspection、diff、target/operation discovery、generation dry-run 和 generation check 可以读取有界 Workspace state。Dry-run/check 可能执行 trusted plugin，但不会调用 writer，也不会 create/update generated file、ownership manifest、selection state、disk plan、lock、staging、backup 或 journal。

## Prepare and Apply

`--allow-write` 是 operator capability grant。它不证明有人批准了 Tool call，也不允许 AI Host 绕过自身 approval policy。

1. Prepare 执行 generation，并存储有界、短生命周期的 in-memory plan。它返回 added/modified/deleted summary、`planId`、one-time token 和 exact plan hash，但不写入任何 Workspace file。
2. Host 必须展示已 review 的 plan，并按照自身 policy 获取 approval。
3. Apply 只接受返回的 `planId`、token 和 approved hash。它会重新 generation，并拒绝 expired、replayed、tampered 或 stale plan。
4. Commit 前，Apply 重新验证 config/input/local 与 remote reference hash、Workspace/output identity、ownership/current file、generated artifact 和 prepared plan。它获取共享的 CLI/MCP output lock，并使用 Core 的 transaction journal、staging、verification、rollback 与 recovery path。

不存在 force flag、stale override、direct-write Tool、dynamic target/config/plugin selection，也不存在 caller-supplied output path/content。

## Host approval

Server 可以证明 Apply 与 Prepare 匹配，但无法证明是谁 review 了 plan。对 `openapi_apply_generation` 保持 Host approval，尤其是在存在 deletion 时；不要对 write-enabled server 启用 blanket auto-run。

## Process streams

stdin 和 stdout 仅承载 MCP JSON-RPC。Operational log 与重定向的 incidental plugin output 使用 stderr。不要用会向 stdout 打印 banner 或 progress 的 command 包装 Server。`--log-format json` 在 stderr 输出 newline-delimited operational record，而不是 MCP response。

## Filesystem and network boundary

Local entry、transitive `$ref`、trusted config import、output root、manifest 和 Generation Intent state 均限制在 real Workspace 内，并检查 traversal 与 symlink escape。Remote access 仅 HTTP(S)，默认拒绝 private/reserved network，并应用 allowed-host、redirect、timeout、DNS 和 response-size policy。

Workspace-local native Windows absolute input path 会被接受，不会把 drive letter 当作 URL scheme。Drive-relative Windows path、UNC path 和 configured `file:` URL 会被拒绝。每个 configured Target 都有独立的 output root。Core 在 generation 前拒绝 Workspace root、absolute/drive/UNC output path、Windows reserved device name/character、trailing period/space、`.git`、`node_modules`、root `.openapi-to` state directory 下的任何 Workspace output、symlinked ancestor、equal root 以及 parent/child output overlap。Managed output 保持在 `.openapi-to` 下，但不能使用 reserved control-state child；Workspace output 仍归 generator 所有，并在该 output root 中保留 ownership manifest。Generation Intent 保持在 `.openapi-to/generation-intents`，不能与 output overlap。

Target remote config 描述 trusted access requirement。MCP startup policy 是 operator-owned upper bound；effective policy 是两者 intersection。Private-network access 要求两层都明确为 `true`，allowed-host pattern 必须重叠，timeout/response-size/redirect limit 取较小的 configured value。Target header 会保留，但 Tool schema 不能提供或修改它们。

每个 redirect 和 remote `$ref` 都会重复进行 Remote URL validation。DNS 在 policy validation 和连接时都会检查，包括 IPv4-mapped IPv6/private result。Redirect、duration、decompressed bytes 和 cancellation 均有界。Origin identity 包含 scheme、hostname 和 effective port。Same-Origin redirect 保留 configured request header；第一个 cross-Origin hop 会清除后续链路的全部 header。HTTPS-to-HTTP redirect 在 downgraded request 前被拒绝。`Set-Cookie` 是 response header，绝不会从 configured request header 发送。Diagnostic、plan、state、manifest、journal、response 和 operational log 都使用 sanitized data，绝不包含 configured header value。

详细说明见 [threat model](./mcp-threat-model.md)、[controlled-write architecture](./architecture/mcp-controlled-write.md)、[recovery guide](./mcp-write-recovery.md) 和 [limitations](./mcp-limitations.md)。
