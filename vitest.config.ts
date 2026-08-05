import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const srcAlias = fileURLToPath(new URL('./src', import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': srcAlias },
  },
  test: {
    // Each `db` test file boots its own in-process Postgres, so files run one
    // at a time rather than several WASM instances competing for memory.
    fileParallelism: false,
    projects: [
      {
        // Pure logic: sync engines, mappers, CSV, validation, notifications.
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        // Real Postgres (PGlite) — migrations, constraints, RLS policies.
        extends: true,
        test: {
          name: 'db',
          environment: 'node',
          include: ['tests/db/**/*.test.ts'],
          testTimeout: 120_000,
          hookTimeout: 180_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: ['tests/ui/**/*.test.tsx'],
          setupFiles: ['tests/ui/setup.ts'],
        },
      },
    ],
  },
})
