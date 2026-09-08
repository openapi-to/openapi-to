import { optionsCJS, optionsESM } from "@openapi-to/config-tsdown";

import { defineConfig } from "tsdown";

export default defineConfig([
  {
    ...optionsCJS,
  },
  {
    ...optionsESM,
  },
]);
