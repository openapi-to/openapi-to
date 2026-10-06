# Faker Generator v1 — Approved Design Contract

Status: **Approved Design / Not Implemented**

Issue: #183  
Downstream: #189  
Approved baseline: `73f775e92a1e18e1c022e6b1937b1d7310a5f203`

This document records the approved public and architecture contract for the future official `@openapi-to/plugin-faker`. It does **not** mean the Faker generator is implemented. Until #183 is merged and post-merge verified, the Capability Matrix remains `Not Supported`.

## Responsibilities

```text
Core
  compiler/schema/response classification/artifact authority

plugin-ts-type
  generated TypeScript type authority

plugin-faker
  deterministic Faker factory source generation

consumer
  Faker instance / seed / locale / refDate / runtime random sequence authority

plugin-msw (#189)
  downstream consumer of stable OperationFaker metadata
```

`plugin-faker` depends on `pluginEnum.TsType`; it must not duplicate TypeScript schema semantics.

## Public factory API

Generated factories explicitly receive a Faker instance:

```ts
import type { Faker } from "@faker-js/faker";

export function createPet(faker: Faker): Pet {
  // generated source
}
```

Generated code must not import the singleton `faker`, seed Faker, choose locale, set refDate, call `Math.random()`, or read ambient current time during generation.

Consumer owns runtime state:

```ts
faker.seed(42);
faker.setDefaultRefDate("2026-01-01T00:00:00.000Z");
const pet = createPet(faker);
```

Runtime values are reproducible only when Faker version, locale/data, seed, refDate, and call order are the same. A Faker upgrade may change values for the same seed.

## Faker dependency

The published plugin and aggregate `openapi-to` package do not add `@faker-js/faker` as a runtime dependency or peer dependency.

Generated source uses a type-only import. A consumer that executes generated factories must directly install:

```text
@faker-js/faker >=10.0.0 <11
```

Faker v10's Node/ESM requirements apply to the consumer. The repository may use Faker as a dev/test dependency for packed-consumer validation.

## Artifact model

Each generation target owns one deterministic factories artifact:

```text
<target>/faker/factories.ts
```

Exact path formatting may follow current repository conventions, but the contract is one target / one Faker factory artifact / one writer.

- component hooks collect pure component descriptors;
- operation hooks record operation-owned pure descriptors;
- `buildEnd` sorts, collision-checks, renders the single artifact, and publishes OperationFaker metadata;
- concurrent operation hooks must not mutate one shared SourceFile or order-sensitive collection.

## Component factory identity

Public component factories use:

```text
create<ComponentTypeName>
```

Type identity and type artifact paths come from the TypeScript plugin/Core metadata, not duplicated path inference.

Normalization collisions are errors; discovery-order suffixes are forbidden.

## Operation response factory identity

Generate one factory for every supported response status/media representation:

```text
create<OperationName><StatusToken><MediaToken>Response
```

Examples:

```text
createGetPet200ApplicationJsonResponse
createGetPet404ApplicationProblemJsonResponse
createPoll2XXApplicationJsonResponse
createSearchDefaultApplicationJsonResponse
```

Response status/classification/order reuses Core `describeOperationResponses()`; Faker does not define a second success-response policy.

If exact media identities canonicalize to the same token, disambiguation must use a stable identity-derived hash, never discovery order.

## OperationFaker metadata

The dormant metadata shape:

```ts
{ responseSuccess: string; filePath: string }
```

is replaced by structured producer metadata conceptually equivalent to:

```ts
type OperationFakerResponse = {
  statusCode: string;
  sourceStatusCode: string;
  classification: "success" | "error";
  mediaType?: string;
  kind: "schema" | "no-content";
  factoryName: string;
};

type OperationFaker = {
  filePath: string;
  responses: OperationFakerResponse[];
};
```

Exact field naming may follow current Core conventions, but #189 must be able to consume exact file/status/media/export identity without guessing.

## Literal precedence

For Schema Object factories:

```text
const
→ first valid schema examples entry
→ valid schema example
→ valid default
→ scalar enum
→ Faker-generated value
```

Literal candidates must satisfy the plugin's supported constraints. Invalid candidates produce a bounded warning and fall through. A truth-affecting unsupported schema construct causes the factory to fail closed.

Media Type Example Objects are outside Faker v1's value-source policy.

## Supported schema families

| Schema / keyword | v1 contract |
| --- | --- |
| `true` schema | Supported; deterministic `null` is a valid value |
| `false` schema | Not Supported; no possible instance |
| string / number / integer / boolean / null | Supported bounded |
| OAS 3.0 nullable | Supported |
| 3.1/3.2 type arrays | Partial; deterministic supported non-null branch |
| scalar enum / const | Supported |
| array | Supported bounded |
| fixed tuple / prefixItems | Partial |
| object properties / required / optional | Supported bounded |
| additionalProperties false/true | Supported; no arbitrary extra keys generated |
| schema-valued additionalProperties | Partial; no invented keys |
| allOf | Partial; compatible intersections only |
| anyOf | Partial; first supported source-order branch |
| oneOf | Partial; only provably disjoint supported branches |
| not | Not Supported |
| local component refs | Supported |
| guarded recursion | Supported bounded |
| unguarded required recursion | Not Supported |
| discriminator selection | Not Supported v1 |
| pattern | Not Supported v1 |
| known numeric/string/array bounds | Supported bounded |
| unknown truth-affecting maintained keyword | Fail closed when correctness cannot be proved |

Unsupported constructs must emit deterministic plugin diagnostics rather than generating cast-based or invalid data.

## Formats

Known bounded mappings include:

- email → `faker.internet.exampleEmail()`
- uuid → `faker.string.uuid({ version: 4 })`
- uri/url → `faker.internet.url()`
- hostname → `faker.internet.domainName()`
- ipv4 / ipv6 → corresponding Faker internet APIs
- date/date-time → fixed absolute-range `faker.date.between()`, never ambient relative dates
- int32/int64/float/double → bounded numeric generation aligned with current TS/Zod number model
- password → generic bounded string
- byte/binary → Not Supported v1

Unknown/custom string formats emit a bounded fallback warning and use a generic schema-valid string when no other unsupported constraint exists. Dynamic `faker[format]` dispatch is forbidden.

## Resource bounds

Faker v1 hard limits:

```text
MAX_RECURSION_DEPTH = 4
MAX_ARRAY_ITEMS = 32
MAX_SYNTHETIC_STRING_LENGTH = 1024
MAX_COMPOSITION_BRANCHES = 32
MAX_SCHEMA_NODES_PER_FACTORY = 10_000
```

Bounds are capability limits, not public per-build knobs. Exceeding a bound produces a deterministic error unless a schema-valid bounded fallback is explicitly defined.

## Arrays and objects

Array shape is deterministic:

```text
default desired item count = 2
chosen count = clamp(2, minItems, maxItems)
```

`minItems > 32` fails closed.

Object properties are emitted in stable order. Required properties are always included. Optional properties are included deterministically unless `maxProperties` requires truncation; then required fields remain and stable-order optional fields fill the remaining capacity.

No arbitrary additional-property keys are invented.

## Recursion

Recursion state stays internal to the single factories artifact.

At depth 4, the renderer may terminate only with a schema-valid route, such as:

- omit an optional recursive property;
- choose null from a nullable branch;
- choose a finite supported non-recursive union branch.

If no finite valid termination exists, emit `FAKER_UNBOUNDED_RECURSION` and omit that public factory.

## Selective generation

Faker consumes only the current projected HookContext document:

```text
Selection → Dependency Closure → Generation
```

It must not reopen the full original OpenAPI document or generate everything and delete later.

## Operation responses

Core `describeOperationResponses()` is the response identity/classification authority.

- supported schema response → generate factory;
- no-content response → generate a factory returning `undefined`;
- schema-less/unknown media → fail closed for value synthesis;
- item-level/streaming/positional semantics → fail closed.

Faker factories generate data-model values, not wire serialization. #189 may intentionally support a narrower JSON-only MSW adapter.

## Diagnostics

Stable categories should include:

```text
FAKER_UNSUPPORTED_SCHEMA
FAKER_UNSUPPORTED_FORMAT
FAKER_FORMAT_FALLBACK
FAKER_UNSATISFIABLE_CONSTRAINT
FAKER_UNBOUNDED_RECURSION
FAKER_RESOURCE_BOUND_EXCEEDED
FAKER_FACTORY_NAME_COLLISION
FAKER_RESPONSE_MEDIA_UNSUPPORTED
FAKER_TS_TYPE_METADATA_MISSING
FAKER_INVALID_LITERAL_CANDIDATE
FAKER_UNSUPPORTED_COMPOSITION
FAKER_EXTERNAL_REF_UNSUPPORTED
```

Errors omit unreliable factories; warnings are permitted only when a safe fallback exists.

## Package / export contract

Future implementation adds:

```text
packages/plugin-faker/**
```

with the normal official plugin surface and aggregate:

```ts
export { definePlugin as pluginFaker } from "@openapi-to/plugin-faker";
```

Initial plugin config stays minimal:

```ts
export type PluginConfig = {
  importWithExtension?: boolean;
};
```

Seed, locale, refDate, maxDepth and random array length are not plugin config.

## Legacy classification

- `pluginEnum.Faker`: retain.
- `OperationAccessor.operationFaker` / setter: retain the concept, replace the ambiguous metadata shape.
- historical alpha Faker API/package: do not restore.
- `packages/plugin-msw`: not modified by #183.
- dormant `responseDefaultType="faker"`: #189 owns integration/cleanup.

## Capability status

After #183 implementation, the initial Faker capability is **Partial**, not Stable, because regex/general oneOf/not/binary/unbounded recursion and other bounded gaps remain explicit.

Before #183 implementation merges and passes post-merge verification, current capability remains **Not Supported**.

## #189 downstream boundary

#189 remains blocked until #183 is merged and post-merge verified.

Its producer input is the structured `OperationFaker.responses[]` metadata. MSW must not guess paths or exports.

Recommended initial MSW Faker integration is:

```text
canonical success
+ application/json or application/*+json
+ exact status/media factory match
```

No matching factory must produce a deterministic MSW diagnostic rather than a broken import.

## Validation required for #183 implementation

At minimum:

- plugin-faker unit/integration/typecheck/build;
- Core metadata/composition/selective tests;
- TypeScript + Faker composition;
- aggregate/package surface and dependency catalog;
- generated source strict compile/runtime;
- consumer-direct Faker install smoke;
- ESM runtime and modern CJS compatibility if claimed;
- seed reproducibility and fixed-refDate evidence;
- recursion/cycle/resource-bound tests;
- selective closure;
- two-run path/file/byte/diagnostic determinism;
- OAS 3.0/3.1/3.2 focused cases;
- root build/typecheck/test/repository contract/Changeset/lint;
- Fresh Read-only Independent P0/P1 Review;
- exact-head Remote CI.

## Integration authority

This document approves the design contract only. It does not authorize Merge, Merge Queue, Auto-merge, Release, Publish, Tag, or GitHub Release.
