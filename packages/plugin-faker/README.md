# @openapi-to/plugin-faker

Generate bounded Faker factories for OpenAPI component schemas and operation response bodies.

```ts
import { faker } from "@faker-js/faker";
import { defineConfig, pluginFaker, pluginTSType } from "openapi-to";

export default defineConfig({
	servers: [{
		name: "api",
		input: { path: "./openapi.json" },
		output: { base: "workspace", dir: "generated", clean: true },
	}],
	plugins: [pluginTSType(), pluginFaker()],
});

// In application code, configure and inject the consumer-owned runtime.
faker.seed(42);
faker.setDefaultRefDate("2026-01-01T00:00:00.000Z");
// import { createPet } from "./generated/faker/factories.js";
// const pet = createPet(faker);
```

Install `@faker-js/faker` directly in the consuming project with a compatible version `>=10 <11`. The plugin and aggregate `openapi-to` package do not install or own Faker runtime state.

The generated source is deterministic for the same input, configuration, and toolchain. Runtime reproducibility is controlled by the consumer's Faker version, locale, seed, fixed reference date, and factory call order. Seeded values may change between Faker versions.

Date and date-time factories use the fixed absolute interval `2000-01-01T00:00:00.000Z` through `2030-12-31T23:59:59.999Z`; they do not depend on the current time or Faker's relative date helpers.

The maintained schema profile is partial and bounded. It supports boolean, null, string, integer, and finite number values; scalar `const` and `enum`; bounded arrays and objects; local schema references; supported finite recursion; `email`, `uuid`, `uri`, `url`, `hostname`, `ipv4`, `ipv6`, `date`, `date-time`, `time`, and `duration` formats; compatible object `allOf`, safe `anyOf`, provably exclusive `oneOf`; and operation response factories. Media-specific response schemas must match the schema represented by the TypeScript plugin's response type; a different media schema receives `FAKER_UNSUPPORTED_SCHEMA` and is omitted because the plugin does not define parallel response types. `int32` is bounded to its 32-bit range and `int64` uses the JavaScript safe integer subset. It fails closed for `pattern`, `not`, general `oneOf`, external references, unsupported binary data, unbounded recursion, and schema constraints it cannot prove. OAS 3.2 streaming, item-level, and positional media are not generated.

Current resource limits are recursion depth 4, 32 array items, 1024 UTF-16 code units per synthetic string, 32 composition branches, and 10,000 schema nodes per factory.
