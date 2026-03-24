import { NonceSet } from './NonceSet.js'

describe('NonceSet', () => {
  test('returns false for unknown nonce', () => {
    const set = new NonceSet()
    expect(set.has('unknown')).toBe(false)
  })

  test('returns true for added nonce', () => {
    const set = new NonceSet()
    set.add('nonce-1')
    expect(set.has('nonce-1')).toBe(true)
  })

  test('returns false for expired nonce', () => {
    const set = new NonceSet()
    const pastExpires = new Date(Date.now() - 1000).toISOString()
    set.add('expired', pastExpires)
    expect(set.has('expired')).toBe(false)
  })

  test('returns true for non-expired nonce', () => {
    const set = new NonceSet()
    const futureExpires = new Date(Date.now() + 60_000).toISOString()
    set.add('valid', futureExpires)
    expect(set.has('valid')).toBe(true)
  })

  test('different nonces are independent', () => {
    const set = new NonceSet()
    set.add('nonce-a')
    expect(set.has('nonce-a')).toBe(true)
    expect(set.has('nonce-b')).toBe(false)
  })
})
