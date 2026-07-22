import { afterEach, describe, expect, test, vi } from 'vp/test'

import { tempo } from './Methods.js'

const credential = {
  challenge: {
    id: 'challenge_123',
    intent: 'charge',
    method: 'tempo',
    realm: 'api.example.com',
    request: { amount: '100', currency: '0x123', recipient: '0x456' },
  },
  payload: { signature: '0x123', type: 'transaction' },
} as const

function methods(fetch: typeof globalThis.fetch, apiBaseUrl?: string) {
  return tempo({
    currency: '0x123',
    recipient: '0x456',
    relay: { apiBaseUrl, apiKey: 'tempo_api_key', fetch },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('relay', () => {
  test('behavior: delegates validation to Tempo API', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ success: true }),
    )
    const [method_relay, session] = methods(fetch, 'https://relay.example')

    const result = await method_relay.validate!({
      credential,
      request: credential.challenge.request,
    } as never)

    expect(result.details).toEqual({})
    expect(session.intent).toBe('session')
    expect(fetch).toHaveBeenCalledWith(
      new URL('https://relay.example/v1/mpp/validate'),
      expect.objectContaining({
        body: JSON.stringify({ challenge: credential.challenge, payload: credential.payload }),
        headers: expect.objectContaining({
          Accept: 'application/json',
          'content-type': 'application/json',
          'tempo-api-key': 'tempo_api_key',
        }),
        method: 'POST',
      }),
    )
  })

  test('behavior: broadcasts with a challenge-bound idempotency key', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({
        receipt: {
          method: 'tempo',
          reference: '0xabc',
          timestamp: '2026-07-22T00:00:00.000Z',
        },
        success: true,
      }),
    )
    const [method_relay] = methods(fetch)

    const result = await method_relay.broadcast!({
      credential,
      request: credential.challenge.request,
    } as never)

    expect(result).toEqual({
      method: 'tempo',
      reference: '0xabc',
      status: 'success',
      timestamp: '2026-07-22T00:00:00.000Z',
    })
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({ 'idempotency-key': 'mppx_challenge_123' }),
    })
  })

  test('behavior: legacy verify does not broadcast', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ success: true }),
    )
    const [method_relay] = methods(fetch)

    await expect(
      method_relay.verify({ credential, request: credential.challenge.request } as never),
    ).rejects.toMatchObject({ message: 'Payment verification failed.' })
    expect(fetch).not.toHaveBeenCalled()
  })

  test('error: does not expose API relay failure details', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json(
        {
          error: { code: 'policy_denied', message: 'Payment exceeds policy.' },
        },
        { status: 403 },
      ),
    )
    const [method_relay] = methods(fetch)

    await expect(
      method_relay.validate!({ credential, request: credential.challenge.request } as never),
    ).rejects.toMatchObject({ message: 'Payment verification failed.' })
  })

  test('error: rejects malformed successful broadcast responses', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ success: true }),
    )
    const [method_relay] = methods(fetch)

    await expect(
      method_relay.broadcast!({ credential, request: credential.challenge.request } as never),
    ).rejects.toMatchObject({ message: 'Payment verification failed.' })
  })
})
