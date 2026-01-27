import { assertType, describe, expectTypeOf, test } from 'vitest'
import * as Challenge from './Challenge.js'
import * as PaymentHandler from './server/PaymentHandler.js'
import * as Intents from './tempo/Intents.js'

const handler = PaymentHandler.from({
  method: 'tempo',
  realm: 'api.example.com',
  secretKey: 'test',
  intents: {
    charge: Intents.charge,
    authorize: Intents.authorize,
  },
  async verify() {
    return {
      method: 'tempo',
      reference: '0x123',
      status: 'success' as const,
      timestamp: new Date().toISOString(),
    }
  },
})

describe('FromHandler', () => {
  test('extracts method and intent from handler', () => {
    type Result = Challenge.FromHandler<typeof handler>

    assertType<Result['method']>('tempo' as const)
    assertType<Result['intent']>('charge' as 'charge' | 'authorize')

    expectTypeOf<Result['request']>().toHaveProperty('amount')
    expectTypeOf<Result['request']>().toHaveProperty('currency')
  })
})

describe('from', () => {
  test('without handler returns generic Challenge', () => {
    const challenge = Challenge.from({
      id: 'test',
      intent: 'charge',
      method: 'tempo',
      realm: 'api.example.com',
      request: { amount: '1000' },
    })

    expectTypeOf(challenge.method).toBeString()
    expectTypeOf(challenge.intent).toBeString()
  })

  test('with handler narrows to FromHandler type', () => {
    const challenge = Challenge.from(
      {
        id: 'test',
        intent: 'charge',
        method: 'tempo',
        realm: 'api.example.com',
        request: { amount: '1000' },
      },
      { handler },
    )

    assertType<'tempo'>(challenge.method)
    assertType<'charge' | 'authorize'>(challenge.intent)
    expectTypeOf(challenge.request).toHaveProperty('amount')
    expectTypeOf(challenge.request).toHaveProperty('currency')
  })
})

describe('fromResponse', () => {
  test('without handler returns generic Challenge', () => {
    const response = new Response(null, { status: 402 })
    const challenge = Challenge.fromResponse(response)

    expectTypeOf(challenge.method).toBeString()
    expectTypeOf(challenge.intent).toBeString()
  })

  test('with handler narrows to FromHandler type', () => {
    const response = new Response(null, { status: 402 })
    const challenge = Challenge.fromResponse(response, { handler })

    assertType<'tempo'>(challenge.method)
    assertType<'charge' | 'authorize'>(challenge.intent)
    expectTypeOf(challenge.request).toHaveProperty('amount')
    expectTypeOf(challenge.request).toHaveProperty('currency')
  })
})

describe('fromHeaders', () => {
  test('without handler returns generic Challenge', () => {
    const headers = new Headers()
    const challenge = Challenge.fromHeaders(headers)

    expectTypeOf(challenge.method).toBeString()
    expectTypeOf(challenge.intent).toBeString()
  })

  test('with handler narrows to FromHandler type', () => {
    const headers = new Headers()
    const challenge = Challenge.fromHeaders(headers, { handler })

    assertType<'tempo'>(challenge.method)
    assertType<'charge' | 'authorize'>(challenge.intent)
    expectTypeOf(challenge.request).toHaveProperty('amount')
    expectTypeOf(challenge.request).toHaveProperty('currency')
  })
})
