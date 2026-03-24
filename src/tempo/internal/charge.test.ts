import { describe, expect, test } from 'vitest'

import { getTransfers, maxSplits, maxTransferCalls } from './charge.js'

describe('constants', () => {
  test('maxSplits is 10', () => {
    expect(maxSplits).toBe(10)
  })

  test('maxTransferCalls is 1 + maxSplits', () => {
    expect(maxTransferCalls).toBe(1 + maxSplits)
  })
})

describe('getTransfers', () => {
  test('returns single primary transfer when no splits', () => {
    const result = getTransfers({
      amount: '1000000',
      methodDetails: { memo: '0xaabb' },
      recipient: '0x1111111111111111111111111111111111111111',
    })
    expect(result).toEqual([
      {
        amount: '1000000',
        memo: '0xaabb',
        recipient: '0x1111111111111111111111111111111111111111',
      },
    ])
  })

  test('returns primary + split transfers', () => {
    const result = getTransfers({
      amount: '1000000',
      methodDetails: {
        memo: '0xaabb',
        splits: [
          { amount: '200000', recipient: '0x2222222222222222222222222222222222222222' },
          { amount: '100000', recipient: '0x3333333333333333333333333333333333333333' },
        ],
      },
      recipient: '0x1111111111111111111111111111111111111111',
    })
    expect(result).toEqual([
      {
        amount: '700000',
        memo: '0xaabb',
        recipient: '0x1111111111111111111111111111111111111111',
      },
      {
        amount: '200000',
        recipient: '0x2222222222222222222222222222222222222222',
      },
      {
        amount: '100000',
        recipient: '0x3333333333333333333333333333333333333333',
      },
    ])
  })

  test('preserves split memo', () => {
    const result = getTransfers({
      amount: '1000000',
      methodDetails: {
        splits: [
          {
            amount: '200000',
            memo: '0xdeadbeef',
            recipient: '0x2222222222222222222222222222222222222222',
          },
        ],
      },
      recipient: '0x1111111111111111111111111111111111111111',
    })
    expect(result[1]!.memo).toBe('0xdeadbeef')
  })

  test('primary transfer has no memo when methodDetails.memo is undefined', () => {
    const result = getTransfers({
      amount: '1000000',
      methodDetails: {
        splits: [{ amount: '200000', recipient: '0x2222222222222222222222222222222222222222' }],
      },
      recipient: '0x1111111111111111111111111111111111111111',
    })
    expect(result[0]!.memo).toBeUndefined()
  })

  test('throws when split amount is zero', () => {
    expect(() =>
      getTransfers({
        amount: '1000000',
        methodDetails: {
          splits: [{ amount: '0', recipient: '0x2222222222222222222222222222222222222222' }],
        },
        recipient: '0x1111111111111111111111111111111111111111',
      }),
    ).toThrow('each split amount must be positive')
  })

  test('throws when split amount is negative', () => {
    expect(() =>
      getTransfers({
        amount: '1000000',
        methodDetails: {
          splits: [{ amount: '-100', recipient: '0x2222222222222222222222222222222222222222' }],
        },
        recipient: '0x1111111111111111111111111111111111111111',
      }),
    ).toThrow('each split amount must be positive')
  })

  test('throws when split total equals total amount', () => {
    expect(() =>
      getTransfers({
        amount: '1000000',
        methodDetails: {
          splits: [{ amount: '1000000', recipient: '0x2222222222222222222222222222222222222222' }],
        },
        recipient: '0x1111111111111111111111111111111111111111',
      }),
    ).toThrow('split total must be less than total amount')
  })

  test('throws when split total exceeds total amount', () => {
    expect(() =>
      getTransfers({
        amount: '1000000',
        methodDetails: {
          splits: [
            { amount: '600000', recipient: '0x2222222222222222222222222222222222222222' },
            { amount: '600000', recipient: '0x3333333333333333333333333333333333333333' },
          ],
        },
        recipient: '0x1111111111111111111111111111111111111111',
      }),
    ).toThrow('split total must be less than total amount')
  })

  test('handles empty splits array same as no splits', () => {
    const result = getTransfers({
      amount: '1000000',
      methodDetails: { splits: [] },
      recipient: '0x1111111111111111111111111111111111111111',
    })
    expect(result).toHaveLength(1)
    expect(result[0]!.amount).toBe('1000000')
  })

  test('handles undefined methodDetails', () => {
    const result = getTransfers({
      amount: '1000000',
      recipient: '0x1111111111111111111111111111111111111111',
    })
    expect(result).toHaveLength(1)
    expect(result[0]!.amount).toBe('1000000')
  })
})
