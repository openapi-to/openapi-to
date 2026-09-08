import { optionsCJS, optionsESM } from "@openapi-to/config-tsdown";
import { readFile, writeFile } from "node:fs/promises";

import { defineConfig } from "tsdown";

const stripDeclarationSourceMapReference = async (path: URL) => {
  const code = await readFile(path, "utf8");
  const stripped = code.replace(
    /\n?\/\/# sourceMappingURL=[^\n]+\s*$/u,
    "\n",
  );
  if (stripped !== code) {
    await writeFile(path, stripped);
  }
};

export default defineConfig([
  {
    ...optionsCJS,
    clean: false,
    target: "esnext",
  },
  {
    ...optionsESM,
    clean: false,
    target: "esnext",
  },
  {
    ...optionsESM,
    clean: false,
    target: "esnext",
    sourcemap: true,
    entry: {
      utils: "src/utils.ts",
    },
    name: "utils",
    hooks: {
      "build:done": () =>
        stripDeclarationSourceMapReference(
          new URL("./dist/utils.d.ts", import.meta.url),
        ),
    },
    deps: {
      ...optionsESM.deps,
      alwaysBundle: [/find-up/],
    },
  },
  {
    ...optionsCJS,
    clean: false,
    target: "esnext",
    sourcemap: true,
    entry: {
      utils: "src/utils.ts",
    },
    name: "utils",
    hooks: {
      "build:done": () =>
        stripDeclarationSourceMapReference(
          new URL("./dist/utils.d.cts", import.meta.url),
        ),
    },
    deps: {
      ...optionsCJS.deps,
      alwaysBundle: [/find-up/],
    },
  },
]);
