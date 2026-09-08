import { optionsCJS, optionsESM } from '@openapi-to/config-tsdown'
import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    ...optionsCJS,
    clean: false,
    deps: {
      ...optionsCJS.deps,
      alwaysBundle: [/find-up/],
    },
  },
  {
    ...optionsESM,
    clean: false,
  },
  {
    ...optionsCJS,
    clean: false,
    entry: {
      utils: 'src/utils/index.ts',
    },
    name: 'utils',
    deps: {
      ...optionsCJS.deps,
      alwaysBundle: [/find-up/],
    },
  },
  {
    ...optionsESM,
    clean: false,
    entry: {
      utils: 'src/utils/index.ts',
    },
    name: 'utils',
    deps: {
      ...optionsESM.deps,
      alwaysBundle: [/find-up/],
    },
  },
])
