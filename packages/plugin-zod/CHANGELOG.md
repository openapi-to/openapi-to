# @openapi-to/plugin-zod

## 4.0.0-rc.4

### Major Changes

- d71e14f: Raise the minimum supported Node.js runtime from Node 20 to Node 22.

### Patch Changes

- c0dbf3b: Upgrade the compiler and official generator plugins to `oas` 38 while preserving
  operation discovery, OpenAPI 3.0/3.1/3.2 compatibility, referenced parameter and
  request-body semantics, response component identity, response media and composition
  semantics, selective generation, and deterministic generated output.
- be348f6: Preserve precise `z.infer` output types for supported direct, array, map, and
  mutually recursive Zod component schemas while retaining cycle-safe runtime
  validation through `z.lazy()`.
- Updated dependencies [c0dbf3b]
- Updated dependencies [d71e14f]
- Updated dependencies [b91f54a]
  - @openapi-to/core@4.0.0-rc.4

## 4.0.0-rc.3

### Patch Changes

- @openapi-to/core@4.0.0-rc.3

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

### Patch Changes

- Updated dependencies [f5a38fd]
- Updated dependencies [7c87d42]
- Updated dependencies [f405e1a]
  - @openapi-to/core@4.0.0-rc.2

## 4.0.0-rc.1

### Major Changes

- ed854a9: Move automatic configuration discovery to root `openapi.config.ts`, `.js`,
  `.cjs`, or `.mjs` files and move tool-managed state and managed output to
  `.openapi-to`.

  The former `.OpenAPI` configuration location is no longer discovered, and Core
  replaces the removed `folderName` export with `stateDirectoryName`. No
  compatibility fallback or automatic migration is provided; move the
  configuration and any state that must be retained manually.

### Patch Changes

- Updated dependencies [ed854a9]
  - @openapi-to/core@4.0.0-rc.1

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

### Patch Changes

- 642c834: Align published package metadata, documented capabilities, CLI aliases, MCP Host setup, and release verification with the shipped package surfaces.
- Updated dependencies [e373f8c]
- Updated dependencies [4f10867]
- Updated dependencies [642c834]
- Updated dependencies [3e1078b]
- Updated dependencies [ce3f9f2]
- Updated dependencies [862f0ae]
- Updated dependencies [b4130f7]
- Updated dependencies [f0a38b1]
- Updated dependencies [6aac98f]
- Updated dependencies [b4130f7]
- Updated dependencies [ca8f1cb]
- Updated dependencies [235162c]
  - @openapi-to/core@4.0.0-rc.0

## 3.2.2

### Patch Changes

- fix bug
- Updated dependencies
  - @openapi-to/core@3.2.2

## 3.2.1

### Patch Changes

- fix bug
- Updated dependencies
  - @openapi-to/core@3.2.1

## 3.2.0

### Minor Changes

- feat msw

### Patch Changes

- Updated dependencies
  - @openapi-to/core@3.2.0

## 3.1.1

### Patch Changes

- fix bug
- Updated dependencies
  - @openapi-to/core@3.1.1

## 3.1.0

### Minor Changes

- feature: vue query

### Patch Changes

- Updated dependencies
  - @openapi-to/core@3.1.0

## 3.0.1

### Patch Changes

- fix bug
- Updated dependencies
  - @openapi-to/core@3.0.1

## 3.0.0

### Major Changes

- fix bug
- fix: bug
- update
- refactor

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @openapi-to/core@3.0.0

## 3.0.0-alpha.5

### Major Changes

- fix: bug

### Patch Changes

- Updated dependencies
  - @openapi-to/core@3.0.0-alpha.5

## 3.0.0-alpha.4

### Major Changes

- fix bug

### Patch Changes

- Updated dependencies
  - @openapi-to/core@3.0.0-alpha.4

## 3.0.0-alpha.3

### Major Changes

- refactor

### Patch Changes

- Updated dependencies
  - @openapi-to/core@3.0.0-alpha.3

## 3.0.0-alpha.2

### Major Changes

- fix

### Patch Changes

- Updated dependencies []:
  - @openapi-to/core@3.0.0-alpha.2

## 2.4.0-alpha.1

### Patch Changes

- fix bug

- Updated dependencies []:
  - @openapi-to/core@2.4.0-alpha.1

## 2.4.0-alpha.0

### Minor Changes

- update all

### Patch Changes

- Updated dependencies []:
  - @openapi-to/core@2.4.0-alpha.0

## 2.3.0

### Minor Changes

- generate swr

### Patch Changes

- Updated dependencies []:
  - @openapi-to/core@2.3.0

## 2.2.0

### Minor Changes

- fix bug

### Patch Changes

- Updated dependencies []:
  - @openapi-to/core@2.2.0

## 2.1.0

### Minor Changes

- optimize request type zod

### Patch Changes

- Updated dependencies []:
  - @openapi-to/core@2.1.0

## 2.0.0

### Major Changes

- [`e519466`](https://github.com/Vc-great/openapi-to/commit/e5194667c7416e817a498d592c357a7ae9c05f22) Thanks [@Vc-great](https://github.com/Vc-great)! - v2

- [`a39a900`](https://github.com/Vc-great/openapi-to/commit/a39a9002dda434d8a65768f55c69875ed8ad1eea) - fix bug

- 2.0

- [`367be25`](https://github.com/Vc-great/openapi-to/commit/367be252aa434487c09c4566e77792839867b509) - fix bug

- [`7fd9e58`](https://github.com/Vc-great/openapi-to/commit/7fd9e58417ef5563dedf945fbb030b70b8b09bd6) - rc

### Patch Changes

- Updated dependencies [[`e519466`](https://github.com/Vc-great/openapi-to/commit/e5194667c7416e817a498d592c357a7ae9c05f22), [`a39a900`](https://github.com/Vc-great/openapi-to/commit/a39a9002dda434d8a65768f55c69875ed8ad1eea), [`367be25`](https://github.com/Vc-great/openapi-to/commit/367be252aa434487c09c4566e77792839867b509), [`7fd9e58`](https://github.com/Vc-great/openapi-to/commit/7fd9e58417ef5563dedf945fbb030b70b8b09bd6)]:
  - @openapi-to/core@2.0.0

## 2.0.0-rc.5

### Major Changes

- rc

### Patch Changes

- Updated dependencies []:
  - @openapi-to/core@2.0.0-rc.5

## 2.0.0-alpha.4

### Major Changes

- fix bug

### Patch Changes

- Updated dependencies []:
  - @openapi-to/core@2.0.0-alpha.4

## 2.0.0-alpha.3

### Major Changes

- fix bug

## 2.0.0-alpha.2

### Major Changes

- v2
