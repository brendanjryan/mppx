import { describe, expect, test } from 'vitest'
import * as Intent from './Intent.js'
import * as Method from './Method.js'
import * as MethodIntent from './MethodIntent.js'
import * as z from './zod.js'

const fooCharge = MethodIntent.fromIntent(Intent.charge, {
  method: 'test',
  schema: {
    credential: {
      payload: z.object({ signature: z.string() }),
    },
    request: {
      requires: ['recipient'],
    },
  },
})

const fooMethod = Method.from({
  name: 'test',
  intents: { charge: fooCharge },
})

describe('toServer', () => {
  test('default', () => {
    const method = Method.toServer(fooMethod, {
      async verify() {
        return {
          method: 'test',
          reference: 'ref-123',
          status: 'success' as const,
          timestamp: new Date().toISOString(),
        }
      },
    })

    expect(method.name).toBe('test')
    expect(method.intents).toHaveProperty('charge')
    expect(typeof method.verify).toBe('function')
  })

  test('behavior: with context schema', () => {
    const method = Method.toServer(fooMethod, {
      context: z.object({ apiKey: z.string() }),
      async verify() {
        return {
          method: 'test',
          reference: 'ref-123',
          status: 'success' as const,
          timestamp: new Date().toISOString(),
        }
      },
    })

    expect(method.name).toBe('test')
    expect(method.context).toBeDefined()
  })

  test('behavior: with multiple intents', () => {
    const baseMethod = Method.from({
      name: 'test',
      intents: {
        charge: fooCharge,
      },
    })

    const method = Method.toServer(baseMethod, {
      async verify() {
        return {
          method: 'test',
          reference: 'ref-123',
          status: 'success' as const,
          timestamp: new Date().toISOString(),
        }
      },
    })

    expect(method.intents).toHaveProperty('charge')
    expect(Object.keys(method.intents)).toHaveLength(1)
  })
})
