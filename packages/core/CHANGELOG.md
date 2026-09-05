# @openapi-to/core

## 4.0.0-rc.4

### Major Changes

- d71e14f: Raise the minimum supported Node.js runtime from Node 20 to Node 22.

### Patch Changes

- c0dbf3b: Upgrade the compiler and official generator plugins to `oas` 38 while preserving
  operation discovery, OpenAPI 3.0/3.1/3.2 compatibility, referenced parameter and
  request-body semantics, response component identity, response media and composition
  semantics, selective generation, and deterministic generated output.
- b91f54a: Update the YAML parser to the maintained secure js-yaml 4.x baseline, preserving OpenAPI YAML anchors and merges while applying the upstream prototype-pollution and parser-complexity protections.

## 4.0.0-rc.3

## 4.0.0-rc.2

### Major Changes

- f405e1a: Generate Zod 4-only schemas, including top-level string formats, explicit key/value records, executable unions and intersections, safe enum literals and property names, additional-properties policies, and recursive references. Generated consumers now require `zod@^4`; Zod 3 is no longer supported.

  Component schema, parameter, request-body, and response references now import the category's real named export. Operation responses use collision-free per-status declarations, success/error aggregates, and `z.undefined()` for documented no-body responses. OpenAPI 3.1 boolean and empty schemas retain their accept-all/reject-all semantics. Date-time schemas accept required-second RFC3339 values with `Z` or numeric offsets; `int32`, safe-integer, password, and validation-sibling boundaries are explicit and tested. Recursive runtime parsing remains supported while recursive `z.infer` is documented as `unknown`.

  Referenced parameters now retain optional query/header/cookie and required path semantics, including resolved parameter objects that also carry `$ref`. Boolean and empty schemas are preserved at parameter entry points. Response generation includes case-insensitive `1XX` through `5XX` wildcard keys with stable unique names; informational responses use the current non-success aggregate, and `default` keeps its existing fallback behavior.

  Every legal component response now has a real export, with responses lacking content represented by `z.undefined()`. Existing Media Type Objects without `schema` are distinct from absent bodies and generate `z.unknown()` for operation/component request and response entry points, so Zod-backed request services never call an undefined parser. Response header references are excluded from body-schema imports because response-header validation is not currently generated.

  Schema-level `$ref` values with supported validation siblings now pass through the common renderer from operation and component parameter, request-body, and response builders. The renderer continues to apply one uniform intersection/nullable policy rather than dialect-specific OpenAPI 3.0 versus 3.1 behavior. Recursive inference, exact-one `oneOf`, the complete int64 domain, and RFC3339 leap seconds remain outside this change.

  Core now exposes stable path/query/header/cookie parameter classification,
  shared Parameter Object `schema`/`content` extraction, and response semantic
  descriptors. TypeScript and Zod consume those semantics consistently:
  request-header and cookie schemas/types are generated, a selected Media Type
  without `schema` is `unknown`/`z.unknown()`, and a response without content is
  `undefined`/`z.undefined()`. TypeScript retains every documented response
  status member, including mixed `200 + 204` and only-204 operations, and routes
  request-body schema `$ref` siblings such as `nullable` and composition through
  the schema renderer.

  Schema `$ref` siblings now retain one cross-plugin meaning at every parameter,
  request-body, and response entry point: the referenced schema and sibling
  schema both apply. TypeScript renders `$ref + anyOf/oneOf` as
  `Ref & (A | B)`, `$ref + allOf` as intersections, and keeps nullable as
  `Ref | null`; Zod emits the matching intersections/nullable schema. Deep
  sibling refs are imported without duplicates, component response refs use
  their real named export, nullable/composed object responses bypass the
  plain-interface shortcut, and component parameters collect imports per file
  without self-imports.

  Core public Parameter Object types now include OpenAPI 3.1 parameters and keep
  boolean schemas and type arrays valid at parameter entry points. Generated
  header/cookie types and Zod schemas do not change the TypeScript request
  client's public method signature: callers still provide transport values
  through request/client configuration. Exact-one `oneOf`, dialect-specific
  `$ref` sibling rules, recursive `z.infer`, complete int64, leap seconds,
  response-header validation, intelligent multi-Media-Type selection, and
  independent request-client header/cookie parameters remain outside this
  change.

  TypeScript component schemas now use the common schema renderer unless the
  schema is a plain object that can be represented faithfully as an interface.
  Primitive, array, enum, composition, nullable, type-array, boolean, and
  `$ref`-sibling components always emit a real named export. Boolean `true` and
  `false` map to `unknown` and `never`, including required and optional
  properties. Schema-valued `additionalProperties` supplies the index-signature
  value directly and is widened with fixed-property types where TypeScript
  requires compatibility. Component imports are path-aware, deterministic, and
  exclude self-imports while retaining external recursive references.

  Enum collection now traverses validation siblings beside `$ref` without
  resolving the referenced target, so operation and component `$ref + enum`
  outputs import a declared enum value type. Scalar `$ref + const` values are
  rendered as literal intersections in TypeScript and matching intersections in
  Zod. Exact-one `oneOf`, dialect-specific `$ref` sibling rules, recursive
  `z.infer`, the complete int64 domain, leap seconds, response-header validation,
  intelligent multi-Media-Type selection, and independent request-client
  header/cookie parameters remain unchanged.

### Minor Changes

- 7c87d42: Add exact non-empty `replace` semantics to persistent operation selection while preserving the original add-only Core mutation, merge-result, and runtime return-shape contracts. The new generic mutation API lets Selective Prepare replace every legal persisted selection of up to 5,000 operations in one request while retaining per-key, manifest-byte, plan-memory, and bounded-summary limits. Approved Apply commits the complete frozen desired artifacts, ownership-constrained managed deletions, ownership manifest, and selection together while preserving unmanaged files, rollback, and recovery behavior.

### Patch Changes

- f5a38fd: Generated TypeScript files now include a uniform `Generated by openapi-to. DO NOT EDIT.` header.

## 4.0.0-rc.1

### Major Changes

- ed854a9: Move automatic configuration discovery to root `openapi.config.ts`, `.js`,
  `.cjs`, or `.mjs` files and move tool-managed state and managed output to
  `.openapi-to`.

  The former `.OpenAPI` configuration location is no longer discovered, and Core
  replaces the removed `folderName` export with `stateDirectoryName`. No
  compatibility fallback or automatic migration is provided; move the
  configuration and any state that must be retained manually.

## 4.0.0-rc.0

### Major Changes

- e373f8c: Freeze the P0 compiler and P1 Codex governance baseline. This release adds the
  OpenAPI compiler pipeline, structured diagnostics, general generated artifacts,
  validation, inspection, contract diffing, deterministic dry-run/check modes,
  safe remote loading, and the expanded CLI surface.

  The major bump records compatibility-sensitive behavior changes: private-network
  remote sources are blocked by default, conflicting artifact paths fail instead of
  depending on write order, managed output cleanup is manifest-aware, and CLI
  failures now return classified non-zero exit codes.

### Minor Changes

- 4f10867: Add optional invocation-scoped cancellation to compiler, config, plugin, artifact, and comparison APIs, and harden the read-only stdio MCP server with bounded per-tool deadlines, cancellation-safe generation queuing, stable progress, structured stderr logging, fixed evaluation corpora, performance/stress gates, and operational security documentation. Existing Core and CLI calls remain source-compatible because every new execution option is optional. The repository fixed-version group coordinates the eventual public-package minor release; no versioning or publication is performed here.
- 3e1078b: Enable operator-gated controlled Selective Apply through the existing Prepare/Apply Tools. Selective plans now issue kind- and owner-bound one-time tokens, recompile and revalidate the frozen operation projection at Apply time, and atomically commit generated artifacts, ownership, and persistent selection through Core's generation-state transaction. Full generation and controlled full Apply semantics are unchanged.
- ce3f9f2: Add a deterministic Operation Catalog with bounded lexical search and single-operation contract summaries, plus trusted-target MCP discovery, search, and contract Tools with process-local compilation caching.
- 862f0ae: Add shared microservice Target selection and generator-managed Workspace output
  roots. The CLI now accepts repeatable `generate --target` options while Core,
  CLI, MCP, and packed-package smoke workflows share deterministic Target naming,
  output resolution, overlap protection, and write preflight.

  Preserve and verify JSON, YAML, YML, and HTTP(S) OpenAPI inputs across
  multi-target CLI and MCP workflows. Default output remains
  `.OpenAPI/<output.dir>`; opting into `output.base: "workspace"` keeps ownership
  inside the selected project output root while Operation selection remains in
  `.OpenAPI/selections`.

- b4130f7: Add a versioned deterministic operation Selection model and additive Selective Prepare. Prepare unions persisted and requested operations, binds selection/projection/artifacts into a review-only plan, and writes nothing. Selected plans cannot Apply in this phase, while full Prepare/Apply and existing write authority remain unchanged.
- f0a38b1: Add operator-gated, two-phase MCP generation writes through a short-lived HMAC-bound Prepare plan and an exact one-time Apply. Apply re-generates and rejects stale config, source, reference, output, manifest, or file state before committing only managed artifacts.

  Core gains public source/config fingerprints plus a shared cross-process output lock and transaction writer with same-filesystem staging, a stable ownership manifest, rollback, crash journal recovery, commit cancellation/deadline semantics, and fail-closed TOCTOU checks. The CLI keeps its command and output contract while using the same transaction/lock path, so its direct SemVer impact is patch; the fixed-version group will coordinate the eventual release version. No version or publication command is run by this change.

- b4130f7: Add deterministic projected OpenAPI compilations with exact operation selection, transitive named-component closure, and selective `openapi_generate_dry_run` previews. Omitted scope keeps full generation unchanged, and selective previews remain nonpersistent and add no write authority.
- ca8f1cb: Add the independent read-only stdio MCP server with bounded validate, inspect,
  diff, generation dry-run, and generation check Tools. Core gains opt-in local
  file-root confinement for entry and transitive reference reads plus the shared
  trusted configuration loader; the CLI now reuses that loader without changing
  its command contract.
- 235162c: Add a bounded controlled sidecar-state abstraction to the shared Core transaction writer, with checksummed journal v2 state operations, physical preconditions, same-parent staging and backup, three-state rollback, and lock-triggered crash recovery. Existing no-state full writes retain journal v1 and the existing full Prepare/Apply contract.

  Selective plan binding now includes the previous selection physical snapshot and exact desired serialized-byte hash and length. Selective Prepare remains review-only with no returned token, selective Apply remains disabled before locks and writes, and no new MCP write authority or Tool is added.

### Patch Changes

- 642c834: Align published package metadata, documented capabilities, CLI aliases, MCP Host setup, and release verification with the shipped package surfaces.
- 6aac98f: Harden remote loading by clearing trusted request headers on cross-Origin
  redirects and rejecting HTTPS-to-HTTP downgrades. Merge trusted Target remote
  requirements with MCP operator ceilings instead of replacing them; the MCP
  server API can now supply optional remote timeout, response-size, and redirect
  upper bounds while Tool schemas remain unchanged.

  Classify native Windows absolute inputs without treating drive letters as URL
  schemes, reject drive-relative and UNC configured inputs, and require portable
  output segments across Linux, macOS, and Windows. Extend cross-platform CI,
  stable lint coverage, package-surface checks, and real tarball consumers for the
  three aggregate binaries and shared MCP CLI subpath.

## 3.2.2

### Patch Changes

- fix bug

## 3.2.1

### Patch Changes

- fix bug

## 3.2.0

### Minor Changes

- feat msw

## 3.1.1

### Patch Changes

- fix bug

## 3.1.0

### Minor Changes

- feature: vue query

## 3.0.1

### Patch Changes

- fix bug

## 3.0.0

### Major Changes

- fix bug
- fix: bug
- update
- refactor

## 3.0.0-alpha.5

### Major Changes

- fix: bug

## 3.0.0-alpha.4

### Major Changes

- fix bug

## 3.0.0-alpha.3

### Major Changes

- refactor

## 3.0.0-alpha.2

### Major Changes

- fix

## 2.4.0-alpha.1

### Patch Changes

- fix bug

## 2.4.0-alpha.0

### Minor Changes

- update all

## 2.3.0

### Minor Changes

- generate swr

## 2.2.0

### Minor Changes

- fix bug

## 2.1.0

### Minor Changes

- optimize request type zod

## 2.0.0

### Major Changes

- [`e519466`](https://github.com/Vc-great/openapi-to/commit/e5194667c7416e817a498d592c357a7ae9c05f22) Thanks [@Vc-great](https://github.com/Vc-great)! - v2

- [`a39a900`](https://github.com/Vc-great/openapi-to/commit/a39a9002dda434d8a65768f55c69875ed8ad1eea) - fix bug

- 2.0

- [`367be25`](https://github.com/Vc-great/openapi-to/commit/367be252aa434487c09c4566e77792839867b509) - fix bug

- [`7fd9e58`](https://github.com/Vc-great/openapi-to/commit/7fd9e58417ef5563dedf945fbb030b70b8b09bd6) - rc

## 2.0.0-rc.5

### Major Changes

- rc

## 2.0.0-alpha.4

### Major Changes

- fix bug

## 2.0.0-alpha.3

### Major Changes

- fix bug

## 2.0.0-alpha.2

### Major Changes

- v2
