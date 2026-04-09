import net from 'node:net'

import { defineConfig } from '@playwright/test'

const port = await getPort('_MPPX_HTML_PORT')
const hasStripeSecrets =
  Boolean(process.env.VITE_STRIPE_PUBLIC_KEY) && Boolean(process.env.VITE_STRIPE_SECRET_KEY)
const projects = [
  {
    name: 'tempo',
    testMatch: 'tempo.test.ts',
    use: { baseURL: `http://localhost:${port}` },
  },
  ...(hasStripeSecrets
    ? [
        {
          name: 'stripe',
          testMatch: 'stripe.test.ts',
          use: { baseURL: `http://localhost:${port}` },
        },
        {
          name: 'compose',
          testMatch: 'compose.test.ts',
          use: { baseURL: `http://localhost:${port}` },
        },
      ]
    : []),
]

export default defineConfig({
  globalSetup: './globalSetup.ts',
  testDir: '.',
  testMatch: '*.test.ts',
  timeout: 60_000,
  retries: 1,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'list',
  use: {
    headless: !!process.env.CI || true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects,
})

async function getPort(envKey: string): Promise<number> {
  if (process.env[envKey]) return Number(process.env[envKey])
  const port = await new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, () => {
      const port = (server.address() as net.AddressInfo).port
      server.close(() => resolve(port))
    })
    server.on('error', reject)
  })
  process.env[envKey] = String(port)
  return port
}
