import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '../src',
  testMatch: '*.test.ts',
  globalSetup: './setup.global.ts',
  timeout: 60_000,
  use: {
    headless: true,
  },
})
