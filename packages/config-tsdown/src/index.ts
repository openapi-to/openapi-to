import type { UserConfig } from "tsdown";

export const options: UserConfig = {
  entry: ["src/index.ts"],
  treeshake: true,
  sourcemap: false,
  minify: false,
  clean: false,
  platform: "node",
  target: "es2020",
  shims: true,
  fixedExtension: false,
  ignoreWatch: [
    "**/.turbo",
    "**/dist",
    "**/node_modules",
    "**/.DS_STORE",
    "**/.git",
  ],
  deps: {
    neverBundle: ["tsdown", "ts-morph", "lodash", "oas"],
    onlyBundle: false,
    dts: {
      neverBundle: true,
    },
  },
};

export const optionsESM: UserConfig = {
  ...options,
  format: "esm",
  dts: { sourcemap: false },
  outDir: "./dist",
};

export const optionsCJS: UserConfig = {
  ...options,
  format: "cjs",
  dts: { sourcemap: false },
  outDir: "./dist",
};

export const optionsFlat: UserConfig = {
  format: ["cjs", "esm"],
  entry: ["./src/**/!(*.d|*.test).ts"],
  outDir: "./dist",
  sourcemap: true,
  clean: false,
  dts: { sourcemap: false },
  minify: false,
  deps: {
    neverBundle: true,
  },
  treeshake: true,
  shims: true,
  fixedExtension: false,
  ignoreWatch: options.ignoreWatch,
};

export default {
  default: options,
  esm: optionsESM,
  cjs: optionsCJS,
  flat: optionsFlat,
} as const;
