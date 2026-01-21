import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    alias: {
      mpay: path.resolve(import.meta.dirname, 'src'),
      '~test': path.resolve(import.meta.dirname, 'test'),
    },
    globals: true,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    retry: 3,
    globalSetup: ['./test/setup.global.ts'],
    setupFiles: ['./test/setup.ts'],
  },
})
