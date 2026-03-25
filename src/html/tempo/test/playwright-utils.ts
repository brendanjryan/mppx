import * as path from 'node:path'

import { test as base } from '@playwright/test'
import { createClient, defineChain, http, numberToHex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { sendTransactionSync } from 'viem/actions'
import { tempoLocalnet } from 'viem/chains'
import { Actions, Addresses } from 'viem/tempo'
import { createServer } from 'vite'

export const test = base.extend<{ wallet: void }, { baseUrl: string }>({
  baseUrl: [
    // oxlint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const server = await createServer({
        root: path.resolve(import.meta.dirname, '..'),
        configFile: path.resolve(import.meta.dirname, '..', 'vite.config.ts'),
        server: { port: 24678 + Math.floor(Math.random() * 1000), strictPort: false },
      })
      await server.listen()
      process.on('exit', server.close)
      const address = server.httpServer?.address()
      const port = typeof address === 'object' && address ? address.port : 5173
      await use(`http://localhost:${port}`)
      process.off('exit', server.close)
      await server.close()
    },
    { scope: 'worker' },
  ],

  wallet: async ({ baseUrl, page }, use) => {
    const privateKey = generatePrivateKey()
    const account = privateKeyToAccount(privateKey)

    const chain = defineChain({
      ...tempoLocalnet,
      rpcUrls: { default: { http: [process.env.TEMPO_RPC_URL!] } },
    })

    {
      const funderAccount = privateKeyToAccount(
        '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      )
      const client = createClient({ account: funderAccount, chain, transport: http() })
      await Actions.token.transferSync(client, {
        account: funderAccount,
        chain,
        token: Addresses.pathUsd,
        to: account.address,
        amount: 10_000_000n,
      })
    }

    const client = createClient({ account, chain, transport: http() })

    await page.exposeFunction('__mockRequest', async (method: string, params?: unknown) => {
      if (method === 'eth_requestAccounts') return [account.address]
      if (method === 'eth_chainId') return numberToHex(chain.id)
      if (method === 'wallet_switchEthereumChain') return null
      if (method === 'wallet_addEthereumChain') return null

      if (method === 'eth_sendTransactionSync' || method === 'eth_sendTransaction') {
        const [tx] = params as [{ to: `0x${string}`; data: `0x${string}` }]
        const receipt = await sendTransactionSync(client, {
          to: tx.to,
          data: tx.data,
        })
        if (method === 'eth_sendTransactionSync') return receipt
        return receipt.transactionHash
      }

      return client.transport.request({ method, params } as any)
    })

    await page.goto(baseUrl)
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('eip6963:announceProvider', {
          detail: Object.freeze({
            info: {
              uuid: 'test-wallet-uuid',
              name: 'Test Wallet',
              icon: 'data:image/svg+xml,<svg/>',
              rdns: 'com.test.wallet',
            },
            provider: {
              request: async ({ method, params }: { method: string; params?: unknown }) =>
                (window as any).__mockRequest(method, params),
              on() {},
              removeListener() {},
            },
          }),
        }),
      )
    })

    await use()
  },
})
