import { defineConfig } from 'vitest/config'

export default defineConfig({
  server: { host: '127.0.0.1' },
  test: {
    dir: './src',
    globals: true,
    projects: [
      {
        test: {
          name: 'core',
          exclude: ['**/artifacts/transaction.test.ts', '**/artifacts/generation-state-transaction.test.ts'],
          sequence: { groupOrder: 0 },
        },
      },
      {
        test: {
          name: 'core-transaction',
          include: ['**/artifacts/transaction.test.ts', '**/artifacts/generation-state-transaction.test.ts'],
          fileParallelism: false,
          testTimeout: 20_000,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
})
