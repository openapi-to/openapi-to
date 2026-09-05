[![codecov](https://codecov.io/github/Vc-great/openapi-to/branch/V2/graph/badge.svg?token=5UB04YYCEB)](https://codecov.io/github/Vc-great/openapi-to)

The current version is not compatible with V2.[V2 document](https://github.com/Vc-great/openapi-to/tree/v2)



# At a glance

`openapi-to` is a TypeScript compiler, CLI, generator toolkit, and local stdio MCP server for Swagger/OpenAPI documents. The published aggregate includes TypeScript type and request generation, Zod schemas, SWR hooks, Vue Query hooks, MSW handlers, and the MCP runtime. Faker, NestJS, and React Query generators are not shipped.

See the single [capability matrix](docs/capability-matrix.md) for exact package, dialect, CLI, and MCP status. Start with the [getting-started guide](docs/getting-started.md); local AI Host setup is documented for [Codex](docs/codex-mcp.md), [Claude Code](docs/ai-hosts/claude-code.md), [Cursor](docs/ai-hosts/cursor.md), and [generic stdio Hosts](docs/ai-hosts/generic-stdio.md). The [consumer Agent Skills](docs/skills.md) provide setup/diagnosis plus safe Operation-discovery, selective-generation, and integration workflows on top of MCP.

`openapi-to-setup` is the second phase: it diagnoses package, config, ignore,
and Codex MCP state, defaults ambiguous requests to read-only, and binds every
write to an exact Setup Plan. It uses the existing `openapi init`, does not
upgrade an existing version, returns `RESTART_REQUIRED` after Host changes,
and verifies actual Tools and inputSchema after restart. See the
[setup Skill guide](docs/setup-skill.md).

The phase numbers describe product delivery history, not invocation order:
Phase 1 delivered `openapi-to-generate`; Phase 2 delivered
`openapi-to-setup`; Phase 2.1 hardened Setup Plan state hashing; and Phase 2.2
added portable verified reads for Windows without weakening POSIX
`O_NOFOLLOW`. In a consuming project, always run setup first and hand off to
generate only after the requested MCP state and current Tool Schemas are
verified. Automatic setup writes currently cover pnpm and trusted project-level
Codex `.codex/config.toml`; npm, Yarn, Bun, Claude Code, Cursor, and generic
stdio Hosts remain diagnosis/manual-configuration boundaries.

The first-phase `openapi-to-generate` Skill uses the consuming project's local `openapi-to` installation and
checks both the actual MCP Tool list and current Tool inputSchema. Matching Tool
names can expose different capabilities across versions: operation-scoped Dry
Run requires one explicit Target, and selection `replace` is used only when the
current Schema explicitly supports it. The generation Skill does not install dependencies,
edit project or Host configuration, replace MCP, or fall back to full-target
generation when selective generation is unavailable.

# Features

- Works with Node.js 22+.
- Supports local JSON/YAML/YML and policy-constrained HTTP(S) inputs for Swagger 2.0, OpenAPI 3.0, and OpenAPI 3.1.
- Reads OpenAPI 3.2 in compatibility mode with explicit diagnostics for generator gaps; this is not complete 3.2 generation support.
- Provides stable `validate`, `inspect`, `diff`, and `generate` CLI contracts with deterministic JSON output and centralized exit codes.
- Provides a local stdio MCP adapter with default read-only modes and operator-gated Prepare/Apply writes.

Zod generation is Zod 4-only and remains a `Partial` capability. Operation
path, query, header, and cookie parameters share location and requiredness
rules: path is always required and the other locations follow
`required: true`. Parameter Object `content` uses the first declared Media
Type, including `unknown`/`z.unknown()` for a Media Type without `schema`.
OpenAPI 3.1 boolean parameter schemas keep their accept-all/reject-all
semantics. Concrete and wildcard responses are emitted deterministically:
`2xx`/`2XX` are successful, `1xx`/`1XX` and `3xx`–`5xx` wildcards enter the
non-success aggregate, and `default` retains its documented fallback policy.
An existing response Media Type Object without `schema` maps to
`unknown`/`z.unknown()`; a documented response without content maps to
`undefined`/`z.undefined()` in TypeScript/Zod. Response headers are not
currently validated by the Zod plugin, so header references are kept out of
response-body imports. TypeScript request bodies pass schema-level `$ref`
siblings such as `nullable`, type unions, and composition through the schema
renderer. The current uniform OpenAPI 3.0/3.1 generator policy treats a `$ref`
and its sibling schema as simultaneous constraints: TypeScript emits
`Ref & (A | B)` for `$ref + anyOf/oneOf` and intersections for `allOf`, while
Zod emits corresponding intersections. `nullable` remains the documented
compatibility exception and emits `Ref | null`/a nullable ref. `oneOf` remains
an ordinary union approximation, not exact-one validation.

TypeScript component schemas use the same renderer as operation, request, and
response schemas. Primitive, array, enum, composition, nullable, type-array,
`$ref`-sibling, and OpenAPI 3.1 boolean components therefore always emit a
named export; `true` maps to `unknown` and `false` maps to `never`. Boolean
properties are retained with the same mapping. Schema-valued
`additionalProperties` becomes the index-signature value directly, with known
property types included when necessary to keep the interface compilable.
Recursive component types refer to their local declaration without a
self-import.

# Quick Start
## Install
```shell
pnpm add -D openapi-to
```

### Install the Codex consumer Skills

The aggregate installation carries version-matched copies of
`openapi-to-setup` and `openapi-to-generate` through its
`@openapi-to/cli` dependency. Preview and then explicitly install those
offline assets for Codex:

```shell
pnpm exec openapi skills install \
  --host codex \
  --dry-run

pnpm exec openapi skills install \
  --host codex
```

The installer performs no network access. It writes only
`$CODEX_HOME/skills/openapi-to-setup` and
`$CODEX_HOME/skills/openapi-to-generate`; when `CODEX_HOME` is unset, the
root is `~/.codex/skills`. It verifies the package-versioned manifest and
every file hash, refuses either existing target without overwriting, and does
not provide force, update, uninstall, or another Host mode. Restart Codex
after installation so it can load the Skills.

Neither `pnpm add`, `pnpm install`, nor `openapi init` installs Skills.
`openapi init` still only initializes generation configuration and the state
ignore rule. The Skill installer does not configure MCP; after restarting,
use `openapi-to-setup` to inspect and configure the project and Host through
its separate approval boundary.

## Usage 
```json [package.json]
{
  "scripts": {
    "openapi:init": "openapi init",
    "openapi:generate": "openapi g"
  }
}
```

## Commands

`openapi` and `openapi-to` are CLI aliases; `openapi-to-mcp` starts the stdio MCP server. Validation and inspection do not require a generation config.

```shell
pnpm exec openapi init
pnpm exec openapi validate ./openapi.yaml
pnpm exec openapi inspect ./openapi.yaml --json
pnpm exec openapi diff ./old.yaml ./new.yaml --fail-on-breaking
pnpm exec openapi generate --dry-run --json
pnpm exec openapi generate --check --json
pnpm exec openapi-to-mcp --help
pnpm exec openapi-to-mcp --workspace-root .
```

`init` creates `openapi.config.ts` for ESM projects or
`openapi.config.js` for CommonJS projects in the Workspace root and adds only
`/.openapi-to/` to `.gitignore`. Generation searches upward for the nearest
`openapi.config.ts`, `.js`, `.cjs`, or `.mjs`. Multiple supported files in one
candidate directory fail before configuration code executes; use
`--config <path>` when an operator intentionally selects a specific file. The
selected configuration's directory is the generation Workspace, so nested
invocations keep relative inputs and outputs anchored to the project root.

`--json` writes one JSON document to stdout; diagnostics and incidental plugin logs use stderr. `--dry-run` executes plugins and reports the artifact manifest without writing. `--check` performs the same comparison and fails when output is outdated. With `output.clean`, deletion is ownership-based: only files recorded by the previous `.openapi-to-manifest.json` are removed, and unmanaged user files are preserved.

Exit codes are stable: `0` success, `1` general failure, `2` config failure, `3` OpenAPI parse/validation/ref failure, `4` input or remote load failure, `5` plugin failure, `6` outdated generated output, and `7` breaking changes with `diff --fail-on-breaking`.

Remote documents use safe defaults: only HTTP(S), bounded response size and redirects, timeouts, and private/local address blocking including DNS results. Trusted internal APIs must opt in explicitly:

```ts
input: {
  path: 'https://openapi.internal.example.com/api.yaml',
  remote: {
    allowPrivateNetwork: true,
    allowedHosts: ['openapi.internal.example.com'],
    headers: {
      Authorization: process.env.OPENAPI_AUTHORIZATION!,
    },
    timeoutMs: 10_000,
    maxResponseBytes: 10 * 1024 * 1024,
  },
}
```

Configured request headers are retained only across same-Origin redirects. A redirect to a different scheme, hostname, or effective port drops every configured header permanently for the remaining chain; HTTPS-to-HTTP redirects are rejected. JavaScript/TypeScript configuration is trusted executable project code, so operators must inject secrets through their environment or secret platform; `openapi-to` does not provide a general secret manager.

In MCP configured mode, the Target remote policy describes what that Target needs and startup flags describe the operator's maximum authority. The effective policy is their intersection: both layers must explicitly allow private-network access, host allowlists must overlap, and numeric limits use the smaller value. Tool arguments cannot add headers or expand this policy.

Compiler library APIs such as `compileOpenAPI`, `resolveOpenAPIReferences`, `validateOpenAPIDocument`, `inspectOpenAPIDocument`, `diffOpenAPIDocuments`, diagnostics, and `GeneratedArtifact` are exported from both `@openapi-to/core` and `openapi-to`. Existing plugins can keep using `ctx.setSourceFiles`; new plugins may use `ctx.addArtifact` and `ctx.addDiagnostic`.

## Microservices and multiple OpenAPI documents

A Target is one independently generated OpenAPI boundary: a stable name, one input, one output root, and one ownership manifest. An Operation is an endpoint inside that Target. Targets may therefore contain identical `operationId` or Schema names without sharing selection or catalog identity. If one microservice publishes public, admin, and internal documents, configure three Targets rather than merging them implicitly.

```ts
export default defineConfig({
  servers: [
    {
      name: 'user-service',
      input: { path: './openapi/user.json' },
      output: {
        base: 'workspace',
        dir: 'src/api/generated/user',
        clean: true,
      },
    },
    {
      name: 'order-service',
      input: { path: './openapi/order.yaml' },
      output: {
        base: 'workspace',
        dir: 'src/api/generated/order',
        clean: true,
      },
    },
    {
      name: 'payment-service',
      input: {
        path: 'https://api.example.com/openapi?service=payment',
      },
      output: { dir: 'payment' },
    },
  ],
})
```

`input.path` parsing uses response content and Content-Type as well as the URL/path suffix, so extensionless and query-bearing HTTP(S) URLs are supported. `output.base` defaults to `managed`: `dir: 'payment'` still writes to `.openapi-to/payment`. `base: 'workspace'` writes below the Workspace, keeps the ownership manifest in that generated root, and remains generator-managed. Keep hand-written extensions elsewhere, such as `src/api/custom`; generated source is not an eject/scaffold boundary.

Local `input.path` accepts Workspace-relative paths and absolute paths that remain inside the Workspace, including native Windows `C:\...` or `C:/...` paths. Windows drive-relative paths such as `C:openapi.yaml`, UNC paths, and `file:` URLs are rejected. `output.dir` must be portable across Linux, macOS, and Windows: reserved device names, reserved characters, control characters, and segments ending in a period or space are invalid.

`openapi generate` processes all Targets. Repeat `--target` to select services; duplicates are removed and configuration order is preserved. Unknown names and unsafe/overlapping configured outputs fail before any Target writes. Multi-Target CLI generation preflights all selected inputs, then commits each Target independently—it is not a cross-directory global transaction. Whether a generated directory is committed to Git is independent of whether its base is `managed` or `workspace`.

## Release verification

The repository and all published packages require Node.js 22 or newer and use pnpm 10.14.0. Maintainers verify release candidates with the tracked Changesets plan and real local installation smoke tests:

```shell
pnpm exec changeset status
pnpm verify:changeset-state
pnpm lint:changed
pnpm build
pnpm test:release-scripts
pnpm test:consumer:codegen
pnpm verify:package-surface
pnpm release:smoke
```

Feature changesets are merged into `main` as valid pending development state.
Quality CI uses `pnpm verify:changeset-state:development`, while
`release:check` and the Version Readiness workflow keep the strict validator.
On explicit manual dispatch against `main`, `changesets/action@v1` creates or
updates the Version Packages PR and runs the root `version` script there to
settle versions, changelogs, prerelease state, internal dependencies, and the
lockfile. Merging that PR is version metadata maintenance only: npm
publication, tags, and GitHub Releases remain separate, explicitly authorized
operations.

`test:consumer:codegen` proves that the packed aggregate package can generate
and strictly compile real TypeScript, Zod, and request-client output in an
independent consumer. See the
[packed formal-plugin consumer guide](docs/testing/consumer-codegen.md) for
debugging, retained temporary workspaces, and the compact generated-code review
snapshot.

`release:smoke` packs every public workspace package and verifies ESM, CJS,
declarations, all three aggregate binaries, an aggregate-only installation,
real formal-plugin code generation, real MCP stdio startup, and
machine-readable CLI output in temporary consumers. It does not publish.

## MCP verification

The repository exposes stable, package-owned MCP gates instead of relying only
on indirect full-suite discovery:

```shell
pnpm test:mcp:all
pnpm mcp:check
pnpm mcp:inspect                 # safe read-only fixture
pnpm mcp:inspect -- --allow-write # explicit synthetic Prepare/Apply fixture
```

`mcp:check` runs the built stdio Server through the official MCP SDK and reports
the 3/8/10 Tool matrices plus controlled-write health. `mcp:inspect` is a
foreground, authenticated localhost launcher for manual review; it is never an
automated failpoint or crash-recovery gate. See the
[MCP test strategy](docs/testing/mcp-testing.md) and
[Inspector guide](docs/testing/mcp-inspector.md).

OpenAPI 3.2 support and the first-stage diff boundary are maintained in the [capability matrix](docs/capability-matrix.md), not duplicated here.
## Example
```typescript twoslash [single]
import { defineConfig, pluginTSRequest, pluginTSType, pluginZod } from 'openapi-to'


export default defineConfig({
  servers:[
    {
      input: {
        path:'https://petstore.swagger.io/v2/swagger.json'  //api documentation url
      },
       output:{
         dir:'server'
      }
    }
  ],
  plugins: [
    pluginZod(),
    pluginTSType(),
    pluginTSRequest({
      parser: 'zod',
      requestClient: 'axios',
      requestImportDeclaration: {
        moduleSpecifier: '@/utils/request',
      },
      requestConfigTypeImportDeclaration: {
        namedImports: ['AxiosRequestConfig'],
        moduleSpecifier: 'axios',
      }
    })
  ]
})
```
# defineConfig
When using TypeScript/JavaScript you should consider using defineConfig.

# Options
By setting the following options you can override the default behavior of openapi-to and even extend it with your plugins.
## servers
An array of server configurations. Each configuration defines the input source and output destination for the generated code.

### input
You can use either input.path, depending on your specific needs.

**input.path**
Specify a local `.json`, `.yaml`, or `.yml` document inside the trusted local-file boundary, or an `http:`/`https:` URL. Format detection is content-aware and does not require a matching extension.

| Type     | string |
| -------- | ------ |
| Required | True   |

```ts
import { defineConfig } from 'openapi-to'
export default defineConfig({
  servers:[
    {
      input: {
        path:'https://petstore.swagger.io/v2/swagger.json'
      }
    }
  ]
})
```

### output

**output.dir**

The relative directory below `output.base`.

**output.base**

`'managed' | 'workspace'`, defaulting to `'managed'`. Managed output resolves below `.openapi-to`; Workspace output resolves below the project root. Both modes are generator-owned, reject traversal, absolute/UNC/drive paths, symlink escapes, protected state, and overlapping Target roots, and store `.openapi-to-manifest.json` inside the resolved output root.

Switching an existing Target from managed to workspace output does not move, copy, or remove the old `.openapi-to` directory. Verify the new output and remove the old managed output manually if it is no longer needed.

**output.clean**  

Clean the output directory before each build.

| Type: 类型：     | `boolean` |
| :--------------- | --------- |
| Required: 必填： | `false`   |

```ts
import { defineConfig } from 'openapi-to'
export default defineConfig({
  servers:[
    {
      input: {
        path:'https://petstore.swagger.io/v2/swagger.json'
      },
       output:{
         dir:'server'
      }
    }
  ]
})
```

#### output.format 

Specifies the formatting tool to be used.

| Type:     | ` 'biome'` |
| :-------- | :--------- |
| Required: | `false`    |
| Default:  |            |



# plugins

## pluginTSRequest

The  plugin enables you to generate API controllers, simplifying the process of handling API requests and improving integration between frontend and backend services.

By default, we are using [Axios](https://axios-http.com/docs/intro) but you can also add your own client.

**parser**

Which parser should be used before returning the data.

| Type     | Zod   |
| -------- | ----- |
| Required | false |
| Default  |       |

**requestClient**

Request the client

| Type     | axios\|common |
| -------- | ------------- |
| Required | false         |
| Default  | axios         |

axios

```ts
//...
export async function addPetService(data: AddPetMutationRequest, requestConfig?: Partial<AxiosRequestConfig<AddPetMutationRequest>>) {
  const res = await request<AddPetMutationResponse, AxiosResponse<AddPetMutationResponse, AddPetMutationRequest>, AddPetMutationRequest>({
    method: 'POST',
    url: '/pet',
    data: data,
    ...requestConfig
  });
  return res;
}
//...
```

common

```ts
export async function addPetService(data: AddPetMutationRequest, requestConfig?: Partial<AxiosRequestConfig>) {
  const res = await request<AddPetMutationResponse>({
    method: 'POST',
    url: '/pet',
    data: data,
    ...requestConfig
  });
  return res
}
```

Pass an operation header through the generated service's existing
`requestConfig` argument. With the Axios client, for example:

```ts
import type { AddPetMutationRequest } from './add-pet.types'
import { addPetService } from './add-pet.service'

const pet: AddPetMutationRequest = {
  name: 'Fido',
  photoUrls: [],
}

await addPetService(pet, {
  headers: {
    'X-Request-Id': 'request-123',
  },
})
```

For a common client, use the equivalent header property supported by the
configured request-config type and client. Generated TypeScript header types
and Zod header schemas describe or validate an operation's header values; they
do not add a `headers` method argument or automatically transport those values.
Header merging remains request-client behavior, so this documentation does not
define a complete merge-precedence contract. Cookie delivery through client
configuration is likewise not automatic and remains runtime-dependent,
including browser-versus-Node differences.

**requestImportDeclaration**

Request the client Import

| Type     | String          |
| -------- | --------------- |
| Required | false           |
| Default  | @/utils/request |

**requestConfigTypeImportDeclaration**

Request Configuration Type Import

**requestConfigTypeImportDeclaration.namedImports**

Request Configuration Type name

| Type     | String               |
| -------- | -------------------- |
| Required | false                |
| Default  | [AxiosRequestConfig] |

**requestConfigTypeImportDeclaration.moduleSpecifier**

Request Configuration Type module

| Type     | String |
| -------- | ------ |
| Required | false  |
| Default  | axios  |

```ts
 requestConfigTypeImportDeclaration: {
    namedImports: ['AxiosRequestConfig'],
    moduleSpecifier: 'axios',
  }
```

**importWithExtension**

Whether to add an extension (such as .ts) in the import path

| Type     | String |
| -------- | ------ |
| Required | false  |
| Default  | true   |

**dataReturnType**

ReturnType that will be used when calling the client.Use dataReturnType only in get method

| Type     | String |
| -------- |--------|
| Required | false  |
| Default  |        |

**Example**

```ts
pluginTSRequest({
  parser: 'zod',
  dataReturnType:'data',
  requestClient: 'axios',
  requestImportDeclaration: {
    moduleSpecifier: '@/utils/request',
  },
  requestConfigTypeImportDeclaration: {
    namedImports: ['AxiosRequestConfig'],
    moduleSpecifier: 'axios',
  },
   importWithExtension:false
})
```



**pluginTSType**

With the TypeScript plugin you can create [TypeScript](https://www.typescriptlang.org/) types.

**importWithExtension**

Whether to add an extension (such as .ts) in the import path

| Type     | String |
| -------- | ------ |
| Required | false  |
| Default  | true   |


## pluginZod
With the Zod plugin you can use [Zod](https://zod.dev/) to validate your schemas.

`pluginZod` targets Zod 4 only. Install Zod 4 in every project that compiles or
runs the generated schemas:

```shell
pnpm add zod@^4
```

Generated files use `import { z } from 'zod'`. Zod 3 is not supported and
there is no compatibility option. OpenAPI string formats use Zod 4's top-level
format schemas (`z.email()`, `z.url()`, `z.uuid()`, `z.iso.date()`,
`z.iso.datetime({ offset: true })`, and `z.base64()`). Generated `date-time`
schemas require RFC3339 seconds and an uppercase `Z` or bounded numeric offset;
fractional seconds are accepted. Leap seconds are not accepted, so this is a
tested RFC3339 profile rather than a claim of every RFC3339 edge case. The
`password` format remains a UI hint and adds no minimum length by itself.
`int32` enforces signed 32-bit bounds. Plain `integer` and `int64` use Zod's
safe-integer number representation; values outside JavaScript's safe integer
range require a different application-level representation.

OpenAPI 3.1 boolean and empty schemas generate `z.unknown()` for `true`/`{}`
and `z.never()` for `false`, including component, request, response, array, and
composition positions. Component schema, parameter, request-body, and response
references share category-aware export naming. Operation responses use unique
per-status schemas, success/error aggregates, and `z.undefined()` for
documented responses without a body such as 204.

Operation request parameters generate separate path, query, header, and cookie
object schemas. Path entries are always required; query, header, and cookie
entries are optional unless `required: true`. Parameter Object `content`
selects the first declared Media Type deterministically. A selected Media Type
without `schema` generates `z.unknown()`, while `schema: false` generates
`z.never()`. These request-header schemas are distinct from response headers,
which still do not receive validators.

`pluginTSRequest` keeps its existing public call signature: generated header
and cookie metadata does not add independent `headers` or `cookies` method
parameters. Callers pass those values through the selected request
configuration/client configuration (for example, request headers). This
boundary avoids claiming complete request-client header/cookie transport,
including browser-versus-Node cookie behavior and merge precedence.

`oneOf` and `anyOf` are generated as ordinary `z.union([...])` schemas. This
means at least one branch must parse; it does not enforce JSON Schema's
exclusive “exactly one branch” interpretation of `oneOf`. `allOf` is generated
with `z.intersection(...)`.

Validation-affecting sibling keywords are intersected when the renderer can
express them safely. Unsupported combinations produce a structured Zod plugin
diagnostic instead of being silently ignored. This includes a uniform
generator policy for preserved `$ref` siblings; the legacy plugin context does
not currently select different rendering rules for OpenAPI 3.0 versus 3.1 at
that call site. Generated recursive component declarations retain precise
`z.infer` output types for the maintained structurally guarded direct-object,
array, schema-valued map, and mutually recursive component shapes. Their
runtime references remain cycle-safe through `z.lazy()`. Unguarded composition
cycles that TypeScript cannot express without a circular type-alias error use
a bounded `unknown` output fallback while retaining recursive runtime parsing.

**importWithExtension**

Whether to add an extension (such as .ts) in the import path

| Type     | String |
| -------- | ------ |
| Required | false  |
| Default  | true   |

## pluginSWR

With the SWR plugin you can create [SWR hooks](https://swr.vercel.app/) based on an operation.



**infinite**

useSWRInfinite Related configurations

**infinite.pageNumParam**

Generate useSWRInfinite based on pageNumParam

| Type     | String |
| -------- | ------ |
| Required | false  |
| Default  |        |

**importWithExtension**

Whether to add an extension (such as .ts) in the import path

| Type     | String |
| -------- | ------ |
| Required | false  |
| Default  | true   |



**Example**

```ts
    pluginSWR({
      infinite: {
        pageNumParam: 'pageNum'
      },
      importWithExtension:false
    })
```



## pluginVueQuery

With the VueQuery plugin you can create [VueQuery hooks](https://tanstack.com/query/latest/docs/framework/vue/overview) based on an operation.

**requestConfigTypeImportDeclaration**

Request Configuration Type Import

**requestConfigTypeImportDeclaration.namedImports**

Request Configuration Type name

| Type     | String               |
| -------- | -------------------- |
| Required | false                |
| Default  | [AxiosRequestConfig] |

**requestConfigTypeImportDeclaration.moduleSpecifier**

Request Configuration Type module

| Type     | String |
| -------- | ------ |
| Required | false  |
| Default  | axios  |


**responseErrorTypeImportDeclaration**

响应错误类型的 import 声明

**responseErrorTypeImportDeclaration.namedImports**

响应错误类型名称

| Type     | Array\<string> |
| -------- | -------------- |
| Required | false          |
| Default  | [AxiosError]   |

**responseErrorTypeImportDeclaration.moduleSpecifier**

响应错误类型的模块

| Type     | String |
| -------- | ------ |
| Required | false  |
| Default  | Axios  |

**importWithExtension**

Whether to add an extension (such as .ts) in the import path

| Type     | String |
| -------- | ------ |
| Required | false  |
| Default  | true   |

**placeholderData**

Placeholder data configuration when generating hooks

**placeholderData.value**

The value of the placeholder data,When there is no pathInclude attribute, it will be added to all get methods.

| Type     | any    |
| -------- | ------ |
| Required | false  |
| Default  |        |

**placeholderData.pathInclude**

Which paths contain placeholder data (string or regular)

| Type     | Array\<string\|RegExp> |
| -------- | ---------------------- |
| Required | false                  |
| Default  | []                     |

**dataReturnType**

ReturnType that will be used when calling the client.Use dataReturnType only in get method

| Type     | String |
| -------- |--------|
| Required | false  |
| Default  |        |


**Example**

```ts
pluginVueQuery({
  dataReturnType:'data',
  requestConfigTypeImportDeclaration: {
    namedImports: ['AxiosRequestConfig'],
    moduleSpecifier: 'axios',
  },
  responseErrorTypeImportDeclaration: {
    namedImports: ['AxiosError'],
    moduleSpecifier: 'axios',
  },
  importWithExtension: false,
  placeholderData: {
    value: 'keepPreviousData',
    pathInclude: ['/pet', /^\/user/]
  }
})
```



## pluginMSW

With the MSW plugin you can create [mswjs hooks](https://mswjs.io/docs/) based on an operation.

**importWithExtension**

Whether to add an extension (such as .ts) in the import path

| Type     | String |
| -------- | ------ |
| Required | false  |
| Default  | true   |



**Example**

```ts
    pluginMSW({
      importWithExtension:false
    })
```
