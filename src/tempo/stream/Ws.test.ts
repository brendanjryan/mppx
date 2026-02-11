import type { Address, Hex } from 'viem'
import { describe, expect, test } from 'vitest'
import type { ChannelState, ChannelStorage } from './Storage.js'
import type { NeedVoucherEvent, StreamReceipt } from './Types.js'
import {
  formatCredentialMessage,
  formatMessage,
  formatNeedVoucherMessage,
  formatReceiptMessage,
  parseMessage,
  serve,
} from './Ws.js'

const channelId = '0x0000000000000000000000000000000000000000000000000000000000000001' as Hex
const challengeId = 'test-challenge-id'
const tickCost = 1000000n

function memoryStorage(): ChannelStorage {
  const channels = new Map()
  return {
    async getChannel(id) {
      return channels.get(id) ?? null
    },
    async updateChannel(id, fn) {
      const result = fn(channels.get(id) ?? null)
      if (result) channels.set(id, result)
      else channels.delete(id)
      return result
    },
  }
}

function seedChannel(storage: ChannelStorage, balance: bigint): Promise<ChannelState | null> {
  return storage.updateChannel(channelId, () => ({
    channelId,
    payer: '0x0000000000000000000000000000000000000001' as Address,
    payee: '0x0000000000000000000000000000000000000002' as Address,
    token: '0x0000000000000000000000000000000000000003' as Address,
    authorizedSigner: '0x0000000000000000000000000000000000000004' as Address,
    deposit: balance,
    settledOnChain: 0n,
    highestVoucherAmount: balance,
    highestVoucher: null,
    spent: 0n,
    units: 0,
    finalized: false,
    createdAt: new Date(),
  }))
}

describe('formatMessage', () => {
  test('produces valid JSON message format', () => {
    const msg = formatMessage('hello')
    expect(JSON.parse(msg)).toEqual({ type: 'message', data: 'hello' })
  })
})

describe('formatNeedVoucherMessage', () => {
  test('produces valid JSON with payment-need-voucher type', () => {
    const params: NeedVoucherEvent = {
      channelId,
      requiredCumulative: '6000000',
      acceptedCumulative: '5000000',
      deposit: '10000000',
    }
    const msg = formatNeedVoucherMessage(params)
    expect(JSON.parse(msg)).toEqual({ type: 'payment-need-voucher', data: params })
  })
})

describe('formatReceiptMessage', () => {
  test('produces valid JSON with payment-receipt type', () => {
    const receipt: StreamReceipt = {
      method: 'tempo',
      intent: 'session',
      status: 'success',
      timestamp: '2025-01-01T00:00:00.000Z',
      reference: channelId,
      challengeId,
      channelId,
      acceptedCumulative: '2000000',
      spent: '2000000',
      units: 2,
    }
    const msg = formatReceiptMessage(receipt)
    expect(JSON.parse(msg)).toEqual({ type: 'payment-receipt', data: receipt })
  })
})

describe('formatCredentialMessage', () => {
  test('produces valid JSON with payment-credential type', () => {
    const msg = formatCredentialMessage('Payment abc123')
    expect(JSON.parse(msg)).toEqual({ type: 'payment-credential', data: 'Payment abc123' })
  })
})

describe('parseMessage', () => {
  test('parses message type', () => {
    const msg = formatMessage('hello world')
    expect(parseMessage(msg)).toEqual({ type: 'message', data: 'hello world' })
  })

  test('parses payment-need-voucher type', () => {
    const params: NeedVoucherEvent = {
      channelId,
      requiredCumulative: '6000000',
      acceptedCumulative: '5000000',
      deposit: '10000000',
    }
    const msg = formatNeedVoucherMessage(params)
    expect(parseMessage(msg)).toEqual({ type: 'payment-need-voucher', data: params })
  })

  test('parses payment-receipt type', () => {
    const receipt: StreamReceipt = {
      method: 'tempo',
      intent: 'session',
      status: 'success',
      timestamp: '2025-01-01T00:00:00.000Z',
      reference: channelId,
      challengeId,
      channelId,
      acceptedCumulative: '2000000',
      spent: '2000000',
    }
    const msg = formatReceiptMessage(receipt)
    expect(parseMessage(msg)).toEqual({ type: 'payment-receipt', data: receipt })
  })

  test('parses payment-credential type', () => {
    const msg = formatCredentialMessage('Payment xyz')
    expect(parseMessage(msg)).toEqual({ type: 'payment-credential', data: 'Payment xyz' })
  })

  test('returns null for invalid JSON', () => {
    expect(parseMessage('not json')).toBeNull()
  })

  test('returns null for unknown type', () => {
    expect(parseMessage(JSON.stringify({ type: 'unknown', data: 'x' }))).toBeNull()
  })

  test('returns null for non-object', () => {
    expect(parseMessage(JSON.stringify('string'))).toBeNull()
  })
})

describe('Ws.serve', () => {
  test('sends message frames for each yielded value (StreamController)', async () => {
    const storage = memoryStorage()
    await seedChannel(storage, 3000000n)

    const sent: string[] = []
    const send = (data: string) => {
      sent.push(data)
    }

    await serve({
      storage,
      channelId,
      challengeId,
      tickCost,
      send,
      generate: async function* (stream) {
        await stream.charge()
        yield 'hello'
        await stream.charge()
        yield 'world'
        await stream.charge()
        yield 'done'
      },
    })

    const messages = sent.map((s) => JSON.parse(s))

    expect(messages.filter((m) => m.type === 'message').map((m) => m.data)).toEqual([
      'hello',
      'world',
      'done',
    ])
    expect(messages.some((m) => m.type === 'payment-receipt')).toBe(true)

    const channel = await storage.getChannel(channelId)
    expect(channel!.spent).toBe(3000000n)
    expect(channel!.units).toBe(3)
  })

  test('sends payment-need-voucher when balance exhausted and resumes after top-up', async () => {
    const storage = memoryStorage()
    await seedChannel(storage, 1000000n)

    const sent: string[] = []
    const send = (data: string) => {
      sent.push(data)
    }

    const servePromise = serve({
      storage,
      channelId,
      challengeId,
      tickCost,
      pollIntervalMs: 10,
      send,
      generate: async function* (stream) {
        await stream.charge()
        yield 'first'
        await stream.charge()
        yield 'second'
      },
    })

    await new Promise((r) => setTimeout(r, 50))

    await storage.updateChannel(channelId, (current) => {
      if (!current) return null
      return { ...current, highestVoucherAmount: current.highestVoucherAmount + 2000000n }
    })

    await servePromise

    const messages = sent.map((s) => JSON.parse(s))
    expect(messages.some((m) => m.type === 'payment-need-voucher')).toBe(true)
    expect(messages.filter((m) => m.type === 'message').map((m) => m.data)).toEqual([
      'first',
      'second',
    ])
    expect(messages.some((m) => m.type === 'payment-receipt')).toBe(true)
  })

  test('respects abort signal', async () => {
    const storage = memoryStorage()
    await seedChannel(storage, 10000000n)

    const controller = new AbortController()
    const sent: string[] = []

    const servePromise = serve({
      storage,
      channelId,
      challengeId,
      tickCost,
      signal: controller.signal,
      send: (data) => sent.push(data),
      generate: async function* (stream) {
        let i = 0
        while (true) {
          await stream.charge()
          yield `chunk-${i++}`
          await new Promise((r) => setTimeout(r, 5))
        }
      },
    })

    await new Promise((r) => setTimeout(r, 30))
    controller.abort()
    await servePromise

    const messages = sent.map((s) => JSON.parse(s))
    expect(messages.some((m) => m.type === 'message')).toBe(true)
  })

  test('emits receipt with correct spent and units', async () => {
    const storage = memoryStorage()
    await seedChannel(storage, 2000000n)

    const sent: string[] = []

    await serve({
      storage,
      channelId,
      challengeId,
      tickCost,
      send: (data) => sent.push(data),
      generate: async function* (stream) {
        await stream.charge()
        yield 'a'
        await stream.charge()
        yield 'b'
      },
    })

    const messages = sent.map((s) => JSON.parse(s))
    const receipt = messages.find((m) => m.type === 'payment-receipt')?.data

    expect(receipt.challengeId).toBe('test-challenge-id')
    expect(receipt.channelId).toBe(channelId)
    expect(receipt.spent).toBe('2000000')
    expect(receipt.units).toBe(2)
  })

  test('handles empty generator', async () => {
    const storage = memoryStorage()
    await seedChannel(storage, 1000000n)

    const sent: string[] = []

    await serve({
      storage,
      channelId,
      challengeId,
      tickCost,
      send: (data) => sent.push(data),
      generate: async function* () {},
    })

    const messages = sent.map((s) => JSON.parse(s))
    expect(messages.some((m) => m.type === 'payment-receipt')).toBe(true)
    expect(messages.some((m) => m.type === 'message')).toBe(false)

    const channel = await storage.getChannel(channelId)
    expect(channel!.spent).toBe(0n)
    expect(channel!.units).toBe(0)
  })

  test('allows tickCost override', async () => {
    const storage = memoryStorage()
    await seedChannel(storage, 500n)

    const sent: string[] = []

    await serve({
      storage,
      channelId,
      challengeId,
      tickCost: 100n,
      send: (data) => sent.push(data),
      generate: async function* (stream) {
        for (let i = 0; i < 5; i++) {
          await stream.charge()
          yield `tok-${i}`
        }
      },
    })

    const messages = sent.map((s) => JSON.parse(s))
    const dataMessages = messages.filter((m) => m.type === 'message').map((m) => m.data)
    for (let i = 0; i < 5; i++) {
      expect(dataMessages).toContain(`tok-${i}`)
    }

    const channel = await storage.getChannel(channelId)
    expect(channel!.spent).toBe(500n)
    expect(channel!.units).toBe(5)
  })
})
