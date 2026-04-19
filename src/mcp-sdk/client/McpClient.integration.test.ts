import { randomUUID } from 'node:crypto'
import * as http from 'node:http'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { session as tempo_session_client, tempo as tempo_client } from 'mppx/client'
import { Mppx as Mppx_server, tempo as tempo_server } from 'mppx/server'
import type { Address } from 'viem'
import { readContract } from 'viem/actions'
import { Actions } from 'viem/tempo'
import { beforeAll, describe, expect, test } from 'vp/test'
import { nodeEnv } from '~test/config.js'
import { deployEscrow } from '~test/tempo/session.js'
import { accounts, asset, client as testClient } from '~test/tempo/viem.js'

import * as Store from '../../Store.js'
import * as ChannelStore from '../../tempo/session/ChannelStore.js'
import type { SessionReceipt } from '../../tempo/session/Types.js'
import * as McpServer_transport from '../server/Transport.js'
import * as McpClient from './McpClient.js'

const realm = 'api.example.com'
const secretKey = 'test-secret-key'
const chargeAmountRaw = 1_000_000n

let escrowContract: Address

beforeAll(async () => {
  escrowContract = await deployEscrow()
}, 60_000)

describe.runIf(nodeEnv === 'localnet')('McpClient.wrap integration', () => {
  const scenarios = [
    {
      name: 'charge intent settles a paid MCP tool against the live chain',
      async run(harness: Harness) {
        const beforeBalance = await getTokenBalance(accounts[0].address)

        const first = await harness.mcp.callTool({ name: 'charge_tool', arguments: {} })
        const second = await harness.mcp.callTool({ name: 'charge_tool', arguments: {} })

        const afterBalance = await getTokenBalance(accounts[0].address)

        expect(first.content).toEqual([{ type: 'text', text: 'charge tool executed' }])
        expect(second.content).toEqual([{ type: 'text', text: 'charge tool executed' }])
        expect(first.receipt?.status).toBe('success')
        expect(second.receipt?.status).toBe('success')
        expect(first.receipt?.method).toBe('tempo')
        expect(second.receipt?.method).toBe('tempo')
        expect(first.receipt?.reference).toMatch(/^0x[0-9a-f]+$/)
        expect(second.receipt?.reference).toMatch(/^0x[0-9a-f]+$/)
        expect(second.receipt?.reference).not.toBe(first.receipt?.reference)
        expect(afterBalance - beforeBalance).toBe(chargeAmountRaw * 2n)
      },
    },
    {
      name: 'session intent reuses one live channel and advances cumulative metering',
      async run(harness: Harness) {
        const first = await harness.mcp.callTool({ name: 'session_tool', arguments: {} })
        const second = await harness.mcp.callTool({ name: 'session_tool', arguments: {} })

        const firstReceipt = first.receipt as SessionReceipt | undefined
        const secondReceipt = second.receipt as SessionReceipt | undefined

        expect(first.content).toEqual([{ type: 'text', text: 'session tool executed' }])
        expect(second.content).toEqual([{ type: 'text', text: 'session tool executed' }])
        expect(firstReceipt?.intent).toBe('session')
        expect(secondReceipt?.intent).toBe('session')
        expect(firstReceipt?.channelId).toMatch(/^0x[0-9a-f]{64}$/)
        expect(secondReceipt?.channelId).toBe(firstReceipt?.channelId)
        expect(firstReceipt?.acceptedCumulative).toBe(chargeAmountRaw.toString())
        expect(secondReceipt?.acceptedCumulative).toBe((chargeAmountRaw * 2n).toString())

        const channel = await harness.sessionStore.getChannel(secondReceipt!.channelId)
        expect(channel?.highestVoucherAmount).toBe(chargeAmountRaw * 2n)
        expect(channel?.highestVoucher?.channelId).toBe(secondReceipt?.channelId)
      },
    },
    {
      name: 'one live MCP server can serve charge and session tools in the same client session',
      async run(harness: Harness) {
        const chargeResult = await harness.mcp.callTool({ name: 'charge_tool', arguments: {} })
        const sessionResult = await harness.mcp.callTool({ name: 'session_tool', arguments: {} })

        const sessionReceipt = sessionResult.receipt as SessionReceipt | undefined

        expect(chargeResult.content).toEqual([{ type: 'text', text: 'charge tool executed' }])
        expect(chargeResult.receipt?.status).toBe('success')
        expect(chargeResult.receipt?.reference).toMatch(/^0x[0-9a-f]+$/)
        expect(sessionResult.content).toEqual([{ type: 'text', text: 'session tool executed' }])
        expect(sessionReceipt?.intent).toBe('session')
        expect(sessionReceipt?.acceptedCumulative).toBe(chargeAmountRaw.toString())

        const channel = await harness.sessionStore.getChannel(sessionReceipt!.channelId)
        expect(channel?.highestVoucherAmount).toBe(chargeAmountRaw)
      },
    },
  ] as const satisfies readonly {
    name: string
    run: (harness: Harness) => Promise<void>
  }[]

  for (const scenario of scenarios) {
    test(
      scenario.name,
      async () => {
        const harness = await createHarness()

        try {
          await scenario.run(harness)
        } finally {
          await harness.close()
        }
      },
      30_000,
    )
  }
})

type WrappedClient = {
  callTool: (
    params: { name: string; arguments?: Record<string, unknown>; _meta?: Record<string, unknown> },
    options?: { context?: unknown; timeout?: number },
  ) => Promise<McpClient.CallToolResult>
}

type Harness = {
  close: () => Promise<void>
  mcp: WrappedClient
  sessionStore: ChannelStore.ChannelStore
}

async function createHarness(): Promise<Harness> {
  const sessionBackingStore = Store.memory()
  const sessionStore = ChannelStore.fromStore(sessionBackingStore)
  const [chargeMethod] = tempo_client({
    account: accounts[1],
    getClient: () => testClient,
  })

  const payment = Mppx_server.create({
    methods: [
      tempo_server.charge({
        account: accounts[0],
        currency: asset,
        getClient: () => testClient,
      }),
      tempo_server.session({
        account: accounts[0],
        currency: asset,
        escrowContract,
        getClient: () => testClient,
        store: sessionBackingStore,
      }),
    ],
    realm,
    secretKey,
    transport: McpServer_transport.mcpSdk(),
  })

  const mcpServer = new McpServer({ name: 'test-server', version: '1.0.0' })

  mcpServer.registerTool('charge_tool', { description: 'Charge metered tool' }, async (extra) => {
    const result = await (payment.charge({ amount: '1' }) as (input: unknown) => Promise<any>)(
      extra,
    )
    if (result.status === 402) throw result.challenge

    return result.withReceipt({
      content: [{ type: 'text' as const, text: 'charge tool executed' }],
    }) as never
  })

  mcpServer.registerTool('session_tool', { description: 'Session metered tool' }, async (extra) => {
    const result = await (
      payment.session({ amount: '1', suggestedDeposit: '5', unitType: 'tool-call' }) as (
        input: unknown,
      ) => Promise<any>
    )(extra)
    if (result.status === 402) throw result.challenge

    return (result as { withReceipt: (response: unknown) => unknown }).withReceipt({
      content: [{ type: 'text' as const, text: 'session tool executed' }],
    }) as never
  })

  const app = createMcpExpressApp()
  const serverTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: randomUUID,
  })

  await mcpServer.connect(serverTransport as never)

  app.all('/mcp', (req, res) => {
    void (async () => {
      try {
        await serverTransport.handleRequest(req, res, req.body)
      } catch (error) {
        console.error('MCP integration route failed', error)
        if (!res.headersSent) res.status(500).json({ error: String(error) })
      }
    })()
  })

  const httpServer = await createMcpHttpServer(app)
  const sdkClient = new Client({ name: 'test-client', version: '1.0.0' })
  const clientTransport = new StreamableHTTPClientTransport(new URL(`${httpServer.url}/mcp`))
  await sdkClient.connect(clientTransport as never)

  const mcp = McpClient.wrap(sdkClient, {
    methods: [
      chargeMethod,
      tempo_session_client({
        account: accounts[2],
        deposit: '5',
        escrowContract,
        getClient: () => testClient,
      }),
    ],
  })

  return {
    async close() {
      httpServer.close()
      await Promise.allSettled([sdkClient.close(), mcpServer.close(), serverTransport.close()])
    },
    mcp,
    sessionStore,
  }
}

async function getTokenBalance(account: Address): Promise<bigint> {
  return readContract(
    testClient,
    Actions.token.getBalance.call({ account, token: asset }) as never,
  ) as Promise<bigint>
}

async function createMcpHttpServer(handler: http.RequestListener) {
  const server = http.createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const { port } = server.address() as { port: number }

  return {
    close() {
      server.closeAllConnections?.()
      server.closeIdleConnections?.()
      server.close(() => {})
    },
    url: `http://127.0.0.1:${port}`,
  }
}
