import tsconfigPaths from 'vite-tsconfig-paths'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Avoid an ambient localhost DNS dependency in restricted CI/agent sandboxes.
  // Vitest's internal Vite server remains bound to numeric loopback only.
  server: { host: '127.0.0.1' },
  test: {
    globals: true,
    // Repository Agent scripts use Node's built-in test runner, not Vitest.
    exclude: ['**/node_modules/**', '**/dist/**', '**/mocks/**', '**/.agents/**'],
    coverage: {
      include: ['**/*.{js,jsx,ts,tsx,cjs,mjs,cts,mts}'],
      exclude: [
        '**/**/plugin.ts', // exclude because we have e2e
        'throttle', // TODO remove when we use an external library
        '**/dist/**',
        '**/mocks/**',
        '**/examples/**',
        '**/docs/**',
        '**/configs/**',
        '**/scripts/**',
        '**/index.ts',
        '**/types.ts',
        '**/jsx-runtime.ts',
        '**/bin/**',
        '**/packages/cli/**',
        '**/packages/config/**',
        '**/packages/kubb/**',
        '**/packages/swagger-ts/src/oas/**',
        '**/packages/swagger-client/client.ts',
        '**/e2e/**',
        '**/coverage/**',
        '**/*.json',
        // Vitest 4's AST remapper cannot parse these pre-existing generated fixtures.
        '**/packages/plugin-swr/test-output/pet/use-find-pets-by-status.query.ts',
        '**/packages/plugin-swr/test-output/pet/use-find-pets-by-tags.query.ts',
        '**/packages/plugin-swr/test-output/user/use-login-user.query.ts',
        // Vite 8's Rolldown parser cannot parse this pre-existing generated mock.
        '**/packages/plugin-swr/mock/newPetAPI.ts',
        '**/packages/*/test?(s)/**',
        '**/*.d.ts',
        'test?(s)/**',
        '**/*{.,-}{test,spec}.?(c|m)[jt]s?(x)',
        '**/__tests__/**',
        '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsdown,build}.config.*',
        '**/.{eslint,mocha,prettier}rc.{?(c|m)js,yml}',
      ],
    },
  },
  plugins: [tsconfigPaths()],
})
