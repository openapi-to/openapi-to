# Consumer Agent Skills

Agent Skills do not replace openapi-to MCP. The MCP Server supplies the
deterministic, schema-bounded discovery, generation preview, and controlled
Prepare/Apply capabilities. A Skill supplies the calling order, scope choices,
approval boundary, business-code integration steps, and failure handling used
by an AI Host.

## Two consumer phases

The numbering records delivery history: Phase 1 is `openapi-to-generate`,
Phase 2 is `openapi-to-setup`, Phase 2.1 is Setup state-hash hardening, and
Phase 2.2 is Setup's Windows portable verified-read hardening. Phase 2.1 and
Phase 2.2 do not add another consumer Skill. The runtime user path is the other
way around: setup and verify the Host first, then hand the business request to
generate.

The repository ships two specialized consuming-project workflows:

- [`openapi-to-setup`](../.agents/skills/openapi-to-setup/SKILL.md) diagnoses
  package, config, ignore, local command, Codex project configuration, restart,
  and actual Tool capability. It defaults ambiguous setup requests to
  read-only and requires exact Setup Plan approval for every write.

- [`openapi-to-generate`](../.agents/skills/openapi-to-generate/SKILL.md) finds
  the API Operations needed by a business feature, reads bounded contracts,
  prefers operation-scoped generation, prepares an exact write plan, waits for
  approval of its current `planHash`, applies that plan, and integrates the
  generated code into the consuming project.

Use setup for “configure openapi-to in this project”, “why are only three Tools
visible?”, or “enable controlled writes”. Use generate for requests such as
“add user deletion from the API documentation”,
“find the order export endpoint and generate its request code”, or “implement
this page's API call with openapi-to”. Do not use it for pure frontend work or
for changing this Monorepo's MCP, CLI, Core, plugins, or release process.

The repository keeps one authoritative source per Skill under `.agents/skills/`.
The npm build derives versioned distribution assets from those directories;
there is no second maintained source tree. Interface metadata lives beside
each Skill in `agents/openai.yaml`. The canonical GitHub directories remain:

```text
https://github.com/Vc-great/openapi-to/tree/main/.agents/skills/openapi-to-generate
https://github.com/Vc-great/openapi-to/tree/main/.agents/skills/openapi-to-setup
```

After installing the aggregate npm package, Codex users can preview and
explicitly install the two assets carried by that exact package:

```sh
pnpm exec openapi skills install \
  --host codex \
  --dry-run

pnpm exec openapi skills install \
  --host codex
```

This command is offline and currently supports only Codex. It verifies the
package version, manifest, and every packaged file before writing
`$CODEX_HOME/skills/openapi-to-setup` and
`$CODEX_HOME/skills/openapi-to-generate`; the default root is
`~/.codex/skills`. If either target already exists, the command fails before
writing and never overwrites or merges. Restart Codex after installation.
There is no update, uninstall, force, project-level, Claude Code, Cursor, or
generic Host installer in this phase.

The npm install and `openapi init` remain unchanged and never install Skills
implicitly. `openapi init` still owns only generation-config initialization
and the state ignore rule. The Skill installer does not configure MCP. After
restart, invoke `openapi-to-setup` so its separate Setup Plan can diagnose or
configure the consuming project and Codex Host.

## Consumer prerequisites

Install the aggregate package in the consuming Workspace:

```sh
pnpm add -D openapi-to
```

The Skill must use the consuming project's local version. It must not silently
fall back to a global installation, and ordinary users do not need a separate
`@openapi-to/mcp` installation. Launch the local stdio Server through:

```sh
pnpm exec -- openapi-to-mcp
```

Keep the generation config in the Workspace root as `openapi.config.ts`. Keep
that location distinct from `.openapi-to/`, which is openapi-to's runtime state
directory.

`@openapi-to/mcp` remains an advanced MCP-only package boundary. The consumer
Skill MVP targets business projects with the aggregate `openapi-to` package and
must not assume that an MCP-only installation is a complete code-generation
environment. Broader MCP-only consumer support requires separate design.

Before following any workflow, the Skill inspects the MCP Tools actually
exposed to the Host and each relevant current Tool inputSchema. The expected
capability matrix is three analysis Tools without config, eight read-only Tools
with config, and ten Tools with config plus `--allow-write`, but counts are only
orientation. The actual Tool list, Tool inputSchema, and capability fields
returned by current calls take precedence over the consuming project's local
package version, which takes precedence over current or historical
documentation. A matching Tool name does not prove that its newer inputSchema
capabilities exist.

Operation-scoped Dry Run is available only when the current Schema supports
`targets`, `scope.type = operations`, and `scope.operationKeys`. It must use
exactly one grounded Target; in a multi-Target project, list Targets first and
never guess or rely on an omitted Target's default behavior:

```json
{
  "targets": ["<exact-target>"],
  "scope": {
    "type": "operations",
    "operationKeys": ["<exact-operation-key>"]
  }
}
```

If selective Dry Run is unsupported, the Skill stays read-only instead of
falling back to full-target generation. Selection `add` requires explicit
Schema support for `selection` and operation keys; `replace` additionally
requires explicit current inputSchema support for `selection.type = replace`.
When a Host cannot expose inputSchema, the Skill reports that limitation and
fails closed for version-sensitive capabilities rather than sending parameters
from the latest documentation to an older local Tool.

Use the [getting-started guide](./getting-started.md) for package and project
configuration, then configure the trusted local Server with the
[Codex MCP guide](./codex-mcp.md). The write-enabled Codex example keeps
`openapi_apply_generation` in prompt approval mode.

## Phase boundary

The setup Skill is phase two. It runs read-only diagnosis first, uses the
existing `openapi init`, does not upgrade an existing version, and supports
automatic package mutation only for pnpm. Every installation or configuration
change requires the exact current Setup Plan ID. Codex project configuration
is Codex-first; npm, Yarn, and Bun plus Claude Code, Cursor, and generic Host
writes remain diagnostic/manual boundaries. Host changes return
`RESTART_REQUIRED`, and the actual Tool list plus current Tool inputSchema are
verified only after restart. See [the setup guide](./setup-skill.md).

The generate Skill remains phase one and never installs dependencies or
modifies `package.json`, `openapi.config.ts`, or `.codex/config.toml`. Setup does
not add MCP Tools or replace MCP, and it hands daily API discovery, selective
generation, and integration to generate after the requested mode is verified.

The handoff follows one closed rule:

| Observed setup state | Generate handoff |
| --- | --- |
| `MCP_READ_ONLY` with compatible current Tool Schemas | Operation discovery, bounded contract reading, and operation-scoped Dry Run only. |
| `MCP_WRITE_ENABLED` with compatible current Dry Run, Prepare, and Apply Schemas | The separately approval-bound Prepare/Apply workflow may also begin. |
| Any other state | No Generate handoff; finish or repair setup first. |

This default-deny row includes `MCP_ANALYSIS_ONLY` and every pre-verification,
blocked, or future state. `--allow-write` is neither Setup Plan approval nor
generation Apply approval.

Automatic setup support is limited to pnpm and trusted project-level Codex
`.codex/config.toml`. npm, Yarn, Bun, Claude Code, Cursor, and generic stdio
Hosts can be diagnosed, but their writes remain manual. Neither Skill uses a
global package fallback, silently upgrades openapi-to, executes an untrusted
generation config during setup diagnosis, or treats Tool count as capability
proof.

## Acceptance-test ownership

The focused Setup Inspector Node tests own setup state transitions and safe
inspection. `pnpm test:consumer:codegen` owns packed formal-plugin generation,
strict compile, runtime, drift, and idempotence. Its
`test:consumer:codegen:review` alias only exports a human-review snapshot after
that same test passes. `pnpm release:smoke` is the canonical full packed
consumer acceptance entry and reuses the codegen scenario plus its single
tarball set.

Release smoke also runs a narrow bridge between the repository-Skill Inspector
and the packed MCP in one external consumer. It proves the inferred
read-only/write-enabled mode agrees with the actual named Prepare/Apply
capability and that Setup evidence expires on observed-state drift. It is not
a model-behavior test or a second golden path. The complete assignment is in
the [consumer acceptance coverage matrix](./testing/consumer-acceptance-matrix.md).
