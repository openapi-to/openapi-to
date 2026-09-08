import { optionsCJS, optionsESM } from '@openapi-to/config-tsdown'
import { defineConfig } from 'tsdown'

export default defineConfig([
  { ...optionsCJS, entry: { index: 'src/index.ts', cli: 'src/cli.ts' } },
  { ...optionsESM, entry: { index: 'src/index.ts', cli: 'src/cli.ts' } },
])
