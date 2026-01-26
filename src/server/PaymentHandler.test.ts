import { describe, expect, test } from 'vitest'
import * as Challenge from '../Challenge.js'
import * as Credential from '../Credential.js'
import * as Intents from '../tempo/Intents.js'
import * as PaymentHandler from './PaymentHandler.js'

const secretKey = 'test-secret-key'
const realm = 'api.example.com'

const handler = PaymentHandler.from({
  method: 'tempo',
  realm,
  secretKey,
  intents: {
    charge: Intents.charge,
    authorize: Intents.authorize,
  },
  async verify(_credential, _challenge) {
    return {
      status: 'success' as const,
      timestamp: new Date().toISOString(),
      reference: `0x${'a'.repeat(64)}`,
    }
  },
})

describe('from', () => {
  test('behavior: creates handler with intent methods', () => {
    expect(handler.method).toBe('tempo')
    expect(handler.realm).toBe('api.example.com')
    expect(typeof handler.charge).toBe('function')
    expect(typeof handler.authorize).toBe('function')
  })
})

describe('intent function', () => {
  test('behavior: returns 402 when no Authorization header', async () => {
    const request = new Request('https://api.example.com/resource')

    const result = await handler.charge(request, {
      amount: '1000000',
      currency: '0x20c0000000000000000000000000000000000001',
      recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00',
      expires: '2025-01-06T12:00:00Z',
    })

    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(402)
    expect((result as Response).headers.get('WWW-Authenticate')).toMatch(/^Payment /)
  })

  test('behavior: returns 402 when invalid Authorization header', async () => {
    const request = new Request('https://api.example.com/resource', {
      headers: { Authorization: 'Bearer invalid' },
    })

    const result = await handler.charge(request, {
      amount: '1000000',
      currency: '0x20c0000000000000000000000000000000000001',
      recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00',
      expires: '2025-01-06T12:00:00Z',
    })

    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(402)
  })

  test('behavior: returns 402 when credential id does not match challenge', async () => {
    const credential = Credential.from({
      id: 'wrong-id',
      payload: { signature: '0xabc', type: 'transaction' as const },
    })

    const request = new Request('https://api.example.com/resource', {
      headers: { Authorization: Credential.serialize(credential) },
    })

    const result = await handler.charge(request, {
      amount: '1000000',
      currency: '0x20c0000000000000000000000000000000000001',
      recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00',
      expires: '2025-01-06T12:00:00Z',
    })

    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(402)
  })

  test('behavior: returns null when credential is valid', async () => {
    const requestOptions = {
      amount: '1000000',
      currency: '0x20c0000000000000000000000000000000000001',
      recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00',
      expires: '2025-01-06T12:00:00Z',
    }

    const challenge = Challenge.fromIntent(Intents.charge, {
      secretKey,
      realm,
      request: requestOptions,
    })

    const credential = Credential.from({
      id: challenge.id,
      payload: { signature: `0x${'ab'.repeat(65)}`, type: 'transaction' as const },
    })

    const request = new Request('https://api.example.com/resource', {
      headers: { Authorization: Credential.serialize(credential) },
    })

    const result = await handler.charge(request, requestOptions)

    expect(result).toBeNull()
  })

  test('behavior: returns 402 when credential payload is invalid', async () => {
    const requestOptions = {
      amount: '1000000',
      currency: '0x20c0000000000000000000000000000000000001',
      recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00',
      expires: '2025-01-06T12:00:00Z',
    }

    const challenge = Challenge.fromIntent(Intents.charge, {
      secretKey,
      realm,
      request: requestOptions,
    })

    const credential = Credential.from({
      id: challenge.id,
      payload: { invalid: 'payload' },
    })

    const request = new Request('https://api.example.com/resource', {
      headers: { Authorization: Credential.serialize(credential) },
    })

    const result = await handler.charge(request, requestOptions)

    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(402)
  })

  test('behavior: challenge contains correct method and intent', async () => {
    const request = new Request('https://api.example.com/resource')

    const result = await handler.charge(request, {
      amount: '1000000',
      currency: '0x20c0000000000000000000000000000000000001',
      recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00',
      expires: '2025-01-06T12:00:00Z',
    })

    const header = (result as Response).headers.get('WWW-Authenticate')
    if (!header) throw new Error('Expected WWW-Authenticate header')
    const challenge = Challenge.deserialize(header)

    expect(challenge.method).toBe('tempo')
    expect(challenge.intent).toBe('charge')
    expect(challenge.realm).toBe('api.example.com')
    expect(challenge.request).toMatchObject({
      amount: '1000000',
      currency: '0x20c0000000000000000000000000000000000001',
      recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00',
      expires: '2025-01-06T12:00:00Z',
    })
  })
})
