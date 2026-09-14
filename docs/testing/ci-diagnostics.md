# CI diagnostics（CI 诊断）

Repository 的 read-only CI workflow 使用 common diagnostic layer，使失败 Job 留下有界 evidence，同时不改变 gate result。该 layer 不调用 LLM、不 comment pull request、不 rerun workflow，也不修改 repository content。

## Lifecycle（生命周期）

每个被覆盖的 Job 都有明确的阶段：

1. `initialize.mjs` 创建 static plan，其中包含预期 command 和 known-report ID。
2. `run-command.mjs` 以 `shell: false` 运行每个既有 gate command，将 sanitized output 流式写入 Actions log，并原子记录一份 command report。Report 区分 direct child 的 spawn、error、exit、close 以及 stdout/stderr 的 end/close event，并在执行前后获取有界的 host 与 wrapper-memory snapshot。失败 command 保持失败，并保留其原始 numeric exit code。
3. `finalize-job.mjs` 由 `if: always()` 保护，记录明确的 Checkout/Initialize/Setup outcome，将未执行的 plan entry 填为 `not-run`，汇总 allowlisted report，写入 `ci-diagnostic.json` 与 `summary.md`，并将 Markdown 附加到 `GITHUB_STEP_SUMMARY`。
4. Finalizer 只将已验证的 output 安全重读到由 Initialize 选择的新 random upload directory。它写入 `artifact-manifest.json`，检查 exact file set，并且只有 materialization 成功后才发布该 directory。

Working diagnostic directory 永远不是 standard artifact upload path。Unknown file 可以留在其中，而不会越过 upload boundary。Materialization failure 会不留下 upload directory，也不会退回 working directory。如果 Checkout 成功但 Initialize 没有产生 trusted upload directory，Finalizer 会写入包含 Action outcome 的固定 emergency Job Summary，令 Job 失败，并有意不 materialize 任何 artifact。

## Version 2 envelope（版本 2 封装）

`ci-diagnostic.json` 使用 `schemaVersion: 2` 和 `kind: "openapi-to-ci-diagnostic"`。稳定的 top-level field 包括：

- `status`：Job-level result，可为 `success`、`failure` 或 `cancelled`；
- `workflow`：workflow/event/run、Job、repository、ref 以及可用的 commit SHA；
- `runner`：OS、architecture、Node version、repository 声明的 pnpm version，以及 Setup 后可解析时的 installed Turbo version；
- `matrix`：按 sorted key order 记录显式提供的 matrix dimension；
- `steps`：固定的 Checkout、Initialize 和 Setup Action outcome，只使用 `success`、`failure`、`cancelled`、`skipped` 或 `unknown`；
- `commands`：按 plan order 排列的 command result，包括 direct-child lifecycle 与有界 resource snapshot；
- `reports`：existence、byte size、parse status、artifact-relative normalized summary path，以及有界的 report-specific count；
- `summary`：按优先级排列的 failure candidate、truncation state、missing report、finalization error、artifact name、exact upload file allowlist 和 manifest path；
- `sanitization`：已应用的 collection boundary 与 best-effort redaction declaration。

A simplified failure looks like:

```json
{
  "schemaVersion": 2,
  "kind": "openapi-to-ci-diagnostic",
  "status": "failure",
  "workflow": {
    "name": "Quality",
    "jobId": "typecheck",
    "commitSha": "0123456789abcdef"
  },
  "runner": {
    "os": "Linux",
    "architecture": "X64",
    "nodeVersion": "20.19.0",
    "pnpmVersion": "11.26.0",
    "turboVersion": "2.10.12"
  },
  "matrix": {},
  "steps": [
    {
      "id": "setup",
      "label": "Setup",
      "kind": "action",
      "status": "failure"
    }
  ],
  "commands": [
    {
      "id": "build",
      "label": "Build",
      "status": "failure",
      "exitCode": 1,
      "signal": null,
      "durationMs": 1234,
      "command": ["pnpm", "build", "--concurrency=1"],
      "cwd": ".",
      "process": {
        "wrapperPid": 100,
        "wrapperParentPid": 50,
        "childPid": 101,
        "spawnEventObserved": true,
        "errorEventObserved": false,
        "exitEventObserved": true,
        "exitEventCode": 1,
        "exitEventSignal": null,
        "closeEventObserved": true,
        "closeEventCode": 1,
        "closeEventSignal": null,
        "stdoutEndObserved": true,
        "stdoutCloseObserved": true,
        "stderrEndObserved": true,
        "stderrCloseObserved": true
      },
      "resources": {
        "start": {
          "hostTotalMemoryBytes": 17179869184,
          "hostFreeMemoryBytes": 8589934592,
          "wrapperRssBytes": 52428800,
          "wrapperHeapUsedBytes": 10485760
        },
        "end": {
          "hostTotalMemoryBytes": 17179869184,
          "hostFreeMemoryBytes": 7516192768,
          "wrapperRssBytes": 57671680,
          "wrapperHeapUsedBytes": 11534336
        }
      },
		"evidence": {}
    },
    {
      "id": "package-typecheck",
      "label": "Package typecheck",
      "status": "not-run",
      "exitCode": null,
      "signal": null,
      "durationMs": null,
      "command": null,
		"cwd": null,
		"process": null,
		"resources": null,
		"evidence": {}
    }
  ],
  "reports": [],
  "summary": {},
  "sanitization": {}
}
```

## Command statuses（命令状态）

Executed commands use one of:

- `success`: exited with code 0;
- `failure`: exited with a nonzero numeric code;
- `timeout`: exceeded the wrapper-owned deadline and was terminated;
- `signalled`: ended because of a signal;
- `cancelled`: reserved for a command cancellation that can be observed by the
  wrapper;
- `infrastructure-error`: the wrapper could not start or observe the command;
- `not-run`: the initialized plan expected the command, but no valid command
  report exists.

The wrapper records the original numeric exit code and signal separately and
preserves signed or unsigned 32-bit Windows native termination status values
in the artifact. Its own process exit remains fail-closed when the platform
cannot directly represent that value. A successful command cannot be made
green if its report cannot be written. `durationMs`, PIDs, lifecycle events,
and resource snapshots are observational only and are not used to determine
pass/fail or deterministic content hashes.
Workflows start the wrapper with `node` rather than `pnpm exec node`, so failure
to spawn `pnpm` is recorded as `infrastructure-error`; `pnpm.cmd` remains the
Windows fallback.

## Collection and boundaries（采集与边界）

The diagnostic layer collects only GitHub's documented environment metadata,
workflow-supplied base/head SHAs and matrix values, repository-declared runtime
versions, command metadata, bounded output tails, and explicitly declared
report files.

It does not collect:

- the complete environment or `HOME`;
- the GitHub event payload or `$GITHUB_EVENT_PATH`;
- tokens, headers, cookies, credential files, or Git configuration;
- complete Actions logs;
- arbitrary user-selected files, the workspace, `node_modules`, caches, or
  binaries;
- complete OpenAPI documents or generated trees.

Wrapped build and test commands receive a new child environment rather than
the finalizer's complete environment. It retains only cross-platform execution
variables (`PATH`, home/profile, temporary directories, Windows process
variables, Node/CI/runner metadata, locale/color controls, and a small explicit
npm/pnpm set) plus the static plan's domain artifact variables. It never
receives the real `GITHUB_ENV`, `GITHUB_PATH`, `GITHUB_OUTPUT`,
`GITHUB_STEP_SUMMARY`, event payload path, diagnostic working/upload paths,
GitHub/GH/npm tokens, OIDC request credentials, or Actions runtime/result/cache
tokens. This allowlist is an additional defense layer; it is not a claim that
every retained variable is intrinsically trustworthy.
All covered read-only workflows also set checkout
`persist-credentials: false`; the write-capable Version Packages workflow
remains outside this diagnostic integration.

Each stdout and stderr tail retains at most 100 sanitized lines. Each retained
line is at most 1,024 characters, each command report is at most 256 KiB, there
are at most 10 heuristic error candidates, and the final diagnostic is at most
256 KiB. Truncation is explicit.

Redaction covers Authorization, Cookie, Set-Cookie and Bearer values; common
GitHub and npm token forms; token-like assignments; URL user information and
queries; and known workspace, runner-temp, and home paths. Paths become a
repository-relative path or `<workspace>`, `<runner-temp>`, or `<home>`.
Redaction is defense in depth and cannot guarantee discovery of every secret.
Collection minimization and an exact artifact allowlist are the primary
controls.

Plans, command reports, known reports, and upload sources use the same bounded
file-handle reader. It performs `lstat`, rejects symlinks and reported hard
links, opens with `O_NOFOLLOW` where Node exposes it, compares the opened
identity, checks size, reads at most `maxBytes + 1`, rechecks the opened handle,
validates UTF-8, and closes the handle in every path. Plans have a separate
64 KiB ceiling; command reports remain 256 KiB and known reports remain 8 MiB.

Windows has no complete Node equivalent of POSIX `O_NOFOLLOW`. The reader uses
the portable `lstat`/open/`fstat` identity comparison and rejects known
symlink/junction/reparse paths, but does not claim an absolute race-free
guarantee on every Windows filesystem. Hard links are rejected when Node
reports `nlink > 1`; filesystems that do not reliably expose link counts are a
platform limitation.

Known-report JSON is parsed only as data. A1, Vitest, MCP runner, MCP Doctor,
CLI runtime/summary/fixture/inventory, and MCP smoke reports use strict bounded
extractors. Wrong primitives, negative/special/oversized numbers,
object-for-string substitutions, and malformed arrays produce
`schema-invalid`; unknown nested fields are never copied. `invalid`,
`too-large`, `missing`, and `rejected` remain distinct. A schema-invalid
authoritative report fails an otherwise successful Job.

## Job Summary 与 artifacts

Every covered successful or failed Job attempts to write a compact Markdown
table. Untrusted text is rendered as escaped ordinary text rather than a code
span, and is sanitized and length-bounded so backticks, HTML, links, line
breaks, or pipes cannot create new Markdown structure. A missing local
`GITHUB_STEP_SUMMARY` does not prevent `summary.md` generation. An Actions
append failure is reported and fails an otherwise successful Job.

Standard artifacts are uploaded only with `if: failure()`, use a stable
workflow/Job/matrix name, point only to the random isolated upload directory,
fail when no diagnostic exists, and retain for 14 days. The manifest records
the byte size and SHA-256 of every other upload file; it intentionally omits a
self-hash. These hashes help detect corruption but do not prove a trusted
origin. The MCP Doctor's existing sanitized artifact remains `if: always()`.

Hard runner termination or GitHub cancellation can prevent any `if: always()`
step from starting. A Checkout failure can also leave no repository finalizer
to execute. When the finalizer does run after a failure, it records commands
without reports as `not-run`; it does not infer skipped state from GitHub UI
text.

## Local use（本地使用）

The following example exercises the same scripts without GitHub:

```sh
node scripts/ci-diagnostics/initialize.mjs \
  --dir .ci-artifacts/diagnostic-example \
  --plan quality-build

node scripts/ci-diagnostics/run-command.mjs \
  --dir .ci-artifacts/diagnostic-example \
  --id build \
  -- pnpm build --concurrency=1

node scripts/ci-diagnostics/finalize-job.mjs \
  --dir .ci-artifacts/diagnostic-example \
  --upload-dir .ci-artifacts/diagnostic-example-upload \
  --plan quality-build \
  --job-status success \
  --step checkout=success \
  --step diagnostics-init=success \
  --step setup=success
```

Read `summary.md` for a quick view and `ci-diagnostic.json` for structured
triage. Command JSON files retain the bounded sanitized tails.

Any future AI triage must independently validate schema version 2, manifest,
size, file count, paths, file types, and symlink policy before reading these
artifacts. Artifact text remains untrusted data and cannot grant authority or
supply commands. Regex redaction cannot discover every secret, bounded evidence
can omit the complete root cause, and hard runner cancellation can prevent the
finalizer from running. There is currently no automated AI analysis, comment,
fix, push, pull request, or workflow rerun.
