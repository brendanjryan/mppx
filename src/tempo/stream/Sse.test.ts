import { describe, expect, test } from 'vitest'
import { formatReceiptEvent } from './Sse.js'
import type { StreamReceipt } from './Types.js'

describe('Sse', () => {
  test('formatReceiptEvent produces valid SSE format', () => {
    const receipt: StreamReceipt = {
      method: 'tempo',
      intent: 'stream',
      status: 'success',
      timestamp: '2025-01-01T00:00:00.000Z',
      reference: '0x0000000000000000000000000000000000000000000000000000000000000001',
      challengeId: 'challenge-1',
      channelId: '0x0000000000000000000000000000000000000000000000000000000000000001',
      acceptedCumulative: '1000000',
      spent: '0',
      units: 1,
    }

    const event = formatReceiptEvent(receipt)

    expect(event).toMatch(/^event: payment-receipt\n/)
    expect(event).toMatch(/\ndata: \{.*\}\n\n$/)
    expect(event).toBe(`event: payment-receipt\ndata: ${JSON.stringify(receipt)}\n\n`)
  })

  test('formatReceiptEvent includes txHash when present', () => {
    const receipt: StreamReceipt = {
      method: 'tempo',
      intent: 'stream',
      status: 'success',
      timestamp: '2025-01-01T00:00:00.000Z',
      reference: '0x0000000000000000000000000000000000000000000000000000000000000001',
      challengeId: 'challenge-1',
      channelId: '0x0000000000000000000000000000000000000000000000000000000000000001',
      acceptedCumulative: '5000000',
      spent: '1000000',
      units: 3,
      txHash: '0xabcdef',
    }

    const event = formatReceiptEvent(receipt)
    const data = JSON.parse(event.split('data: ')[1]!.trim())
    expect(data.txHash).toBe('0xabcdef')
  })
})
