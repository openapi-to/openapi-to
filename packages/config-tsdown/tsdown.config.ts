import { defineConfig } from 'tsdown'

import { optionsCJS, optionsESM } from './src/index.ts'

export default defineConfig([optionsCJS, optionsESM])
