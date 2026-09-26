# Packed formal-plugin consumer code generation（打包 formal-plugin consumer codegen）

`pnpm test:consumer:codegen` 是 packed formal-plugin consumer codegen specialist test，负责 generated file、strict compile、runtime、drift 和 idempotence coverage；它不是 full packed consumer release acceptance entry。相邻 capability 的 canonical owner 见 [consumer acceptance coverage matrix](./consumer-acceptance-matrix.md)。过去由 Phase 2 regression harness 承担的 consumer acceptance 已全部收敛到本 specialist test、CLI init integration test 和各 plugin 的 focused test；Phase 2 scripts 与 fixtures 已退休。

Quality 的 pull request 路由另外运行 `pnpm release:smoke:fast`：它使用 fresh packed tarballs，在 isolated consumer 中验证代表性安装后 CLI、Skill 安装、Setup bootstrap 和 MCP validation capability。Fast 不是本 codegen semantic contract 的 owner，也不运行这里的 formal fixture、strict TypeScript matrix、runtime cases、drift 或 byte-stable regeneration。`pnpm release:smoke` 仍保留并调用此完整 specialist scenario，作为 canonical Full Packed Consumer Acceptance；merge-group、main 和 exact publication tarballs 都继续要求 Full。

构建 repository 后运行 independent external-consumer smoke：

```shell
pnpm build
pnpm test:consumer:codegen
```

该 smoke 会 pack 每个 public workspace package，在 operating system temporary directory 下创建 project，使用 first-party tarball overrides 安装 `openapi-to` tarball，并通过普通 registry package exports 安装从当前 repository dependency graph 读取的 exact third-party versions；随后调用已安装的 `node_modules/.bin/openapi` entry。Consumer 的 compiler matrix 固定为 TypeScript 5.9.3、6.0.3 和 7.0.2，显式请求 React、`@types/react`、SWR v2、Vue 3、TanStack Query v5、Axios 1 和 MSW v2，并拒绝任何非 4 的 resolved Zod major version；不会从 e2e workspace 复制 Zod version。React Query usage 通过同一 packed consumer 解析 aggregate 与 direct plugin entrypoint，编译 `QueryClient.fetchQuery`、generated React hooks、typed mutation variables/options、select/error inference，并检查 AbortSignal forwarding 与 caller-owned request config 的 immutable merge。Local fixture 覆盖 base request generation、多种 success/error response、referenced component parameter/request body/response、204 与 default response、OpenAPI 3.1 boolean/empty schema、recursive schema、required/optional/nullable field、RFC3339 offset、numeric constraint、enum、array、record、additional property、union、intersection 和 nested schema。Escaped property name 由 plugin 的 focused generator 与 runtime test 覆盖。

同一 canonical scenario 还生成并严格检查三类 framework consumer：SWR fetcher 的 typed request/error boundary、Vue Query hook 的 Axios request-config/error boundary，以及 MSW handler 对 schema-less JSON 与已知 response body 的区分。Inline enum fixture 同时生成原始属性顺序和 deterministic source-reordered 文档，验证 casing、punctuation、collision、nested inline enum、request-body enum、cross-hook reference 与重排后的 symbol/file-set 稳定性；每一次单独生成仍要求 byte-stable。`packages/cli/src/init.integration.test.ts` 则在 isolated project 中使用真实默认 SWR config，完成 `init --json`、本地替换 input、`generate --dry-run --json`、正式 generate 和 `generate --check --json`。

`scripts/fixtures/consumer-codegen/` 下的 20 个 focused fixture 使其余 edge case 可 review：referenced optional/required/path parameter 与 boolean schema；具体 response 及 `1XX`–`5XX` wildcard response；没有 `schema` 的 operation/component Media Type Object；referenced no-content component response；与 body schema 隔离的 response header reference；operation/component entry point 中的 schema `$ref` sibling 及其 deep import；nullable/composed object response；以及没有 self-import 或 unrelated import 的 per-file component parameter reference。新增的 inline-enum、SWR 和 MSW fixture 由同一 canonical scenario 生成，Vue Query 复用 SWR contract fixture。Wildcard fixture 同时以 Zod 与 TypeScript response generation 编译。Empty-media fixture 运行全部三个 formal plugin，并静态拒绝 request service 中的 `undefined.parse(`。Runtime check 验证 optional query、required path/query、`schema:false`、wildcard aggregate、no-content、`z.unknown()` media、response-body/header isolation、nullable ref 与 sibling `minLength`。Focused plugin test 还锁定 request 或 response 声明多个 media type 时既有的 first-declared selection。

四个 component-schema fixture 会同时运行 TypeScript 和 Zod，覆盖 primitive、array、enum、composition、nullable、type-array 和 boolean component；具有 compatible/incompatible fixed property 的 schema-valued `additionalProperties`；带 external reference 的 direct/array/map recursion；以及 component 与 operation entry point 中的 `$ref + enum/const`。Smoke 会拒绝 empty component file、missing named export、unresolved named import、self-import、undeclared enum value type 和不稳定的 second-generation manifest。Strict assignment 会 exercise generated index signature、boolean-property type、recursive type 与 scalar literal intersection；Zod 4 执行对应的 boolean、recursive、enum 和 const schema。

七个 cross-plugin fixture 还会同时运行 `pluginTSType`、`pluginZod` 和 `pluginTSRequest`，覆盖 operation header/cookie parameter、mixed schema/unknown-media/no-content success response、Parameter Object `content`、request-body schema `$ref` sibling、deep sibling import、response object semantic 和 component parameter import isolation。Generated file 会以 strict mode 编译；Zod parsing 检查 optional/required header/cookie object；compile-time assignment 区分 `undefined` 与 `unknown`，并证明 `$ref + anyOf/allOf` 仍是 intersection；每个 relative named import 都会 resolve，self-import、duplicate export 和 `undefined.parse(` 会被拒绝；第二次 generation 必须 byte-stable。Header/cookie generation 对 request client signature 仍是 metadata-only：caller 通过 request/client configuration 提供 transport value。

Aggregate package 提供 `pluginTSType`、`pluginZod`、`pluginTSRequest`、`pluginReactQuery`、`pluginSWR`、`pluginVueQuery` 和 `pluginMSW`；随后以 `strict: true`、`skipLibCheck: false` 使用同一 generated consumer 真实编译 TypeScript 5.9.3、6.0.3 和 7.0.2。该 compatibility floor 是 generated consumer 的 TS 5.9，不改变 repository CLI 的 TS 7 与 ts-morph 的 TS 6 compiler API bridge。独立 runtime entry 使用 Zod 4 执行 generated model、request body、query、path、response、boolean/empty 与 recursive schema，并检查 accepted/rejected value。Compile-time assertion 锁定 ordinary model/response schema 的 precise inference，以及 recursive schema 已文档化的 `unknown` inference boundary。普通 aggregate-only consumer 的 release smoke 仍不安装 React/TanStack runtime。

这比 plugin unit 或 snapshot test 更广，因为它验证 isolated project 中的 packed aggregate export、installed CLI、config loading、cross-package plugin dependency chain 和 generated import。CLI E2E test 使用 repository workspace，而不是 newly installed tarball。`release:smoke` 使用已 pack 的 tarball 复用这一 exact scenario，并同时执行 package-surface、binary 和 MCP check。

该 specialist test 有一个 optional review-export mode：

```shell
pnpm test:consumer:codegen
pnpm test:consumer:codegen:review
```

`test:consumer:codegen` 是面向 automation 的 specialist validation，并始终清理 operating-system temporary workspace。日常人工 review generated code 时使用 `test:consumer:codegen:review`。后者不是不同的 consumer E2E 或第二个 test layer：它调用相同的 specialist test，只有在 validation、drift recovery、strict compilation、final current check 和 byte-stable regeneration 全部通过后，才将 compact snapshot 原子导出到 `.ci-artifacts/consumer-codegen-review/current`，随后自动移除原 temporary root。

`pnpm release:smoke` 仍是 canonical full packed consumer acceptance entry。它只 pack 一次，在该 exact codegen scenario 中复用相同 tarball，然后验证 package surface、bin、MCP stdio/capability、controlled Prepare/Apply，以及 narrow Setup Inspector-to-packed-MCP handoff bridge。它不再调用任何独立 Phase 2 harness。

Review snapshot 包含 `report.json`、OpenAPI fixture/config、request stub、consumer usage、TypeScript config、`pnpm-lock.yaml`、全部 final generated file 和 ownership manifest。它有意排除 `node_modules`、tarball、pnpm store data，以及 transaction state 和 test 使用的 artificial drift。`.ci-artifacts` 被 Git ignore，review snapshot 不得提交。Snapshot 用于 code review，不用于重新运行 `tsc` 或 installed CLI。

可以直接在 WebStorm 中打开 `.ci-artifacts/consumer-codegen-review/current`，或使用 Finder 的 **Go to Folder** command 并粘贴 absolute path。若要保留两次可 review 的 run，请在同一 owned root 下导出显式名称：

```shell
pnpm test:consumer:codegen -- --export-review-dir .ci-artifacts/consumer-codegen-review/previous
pnpm test:consumer:codegen -- --export-review-dir .ci-artifacts/consumer-codegen-review/current
diff -ru .ci-artifacts/consumer-codegen-review/previous .ci-artifacts/consumer-codegen-review/current
```

不再需要某个 review snapshot 时，可以移除它：

```shell
node --input-type=module -e "import { cleanupReviewExportDirectory as clean } from './scripts/consumer-codegen-smoke.mjs'; await clean('.ci-artifacts/consumer-codegen-review/current')"
```

Cleanup helper 与 replacement 使用相同的 path 和 ownership check；在 WebStorm 或 Finder 中显式删除 `current` folder 也安全。
## Advanced troubleshooting（高级故障排查）

偶尔需要 command-level debugging 时，可使用底层 `--keep` parameter 保留完整 temporary consumer，包括其中的 `node_modules` 和 packed tarball：

```shell
pnpm test:consumer:codegen -- --keep
```

这不是日常 review 的 primary workflow；查看 generated code 请使用 `test:consumer:codegen:review`。最终 output 会打印 absolute retained path。调试完成后手动移除该打印出的 temporary subdirectory，但不要删除包含它的 operating-system temporary directory（例如不要删除 macOS 的 `/var/folders` parent directory）。检查 `consumer/package.json`、`consumer/pnpm-lock.yaml`、`consumer/openapi.config.ts`、`consumer/openapi.json`、`consumer/request.ts`、`consumer/generated/` 和 `consumer/generated/.openapi-to-manifest.json`，然后在保留的 `consumer` directory 中重新运行：

```shell
./node_modules/.bin/openapi generate --target consumer --json
./node_modules/.bin/openapi generate --target consumer --check --json
./node_modules/.bin/tsc -p tsconfig.generated.json
```

Windows 使用对应的 `.cmd` binary。Failure 会指出 stage、command、exit code 和有界 stdout/stderr。Installation failure 通常指向 tarball dependency resolution；generation 或 semantic failure 指向 retained config、fixture 和 manifest；TypeScript failure 指向 generated import 与 request-client contract。若要让 stdout 只有一个稳定 summary document、progress 位于 stderr，请抑制 pnpm lifecycle banner：

```shell
pnpm --silent test:consumer:codegen -- --json
```

JSON mode 恰好向 stdout 写一个 document，并将 progress 及 retained/exported path 发送到 stderr。如果两类 artifact 都有用，可以同时使用 review export 和 retention：

```shell
pnpm --silent test:consumer:codegen -- \
  --json \
  --keep \
  --export-review-dir .ci-artifacts/consumer-codegen-review/current
```
