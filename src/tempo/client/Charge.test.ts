import { describe, expect, test, vi } from 'vitest'
import type { resolveSettlement as resolveSettlementType, SettlementResolution } from './Charge.js'

// ---------------------------------------------------------------------------
// Mock viem/tempo Actions so we can test resolveSettlement without a network.
// ---------------------------------------------------------------------------

const mockGetBalance = vi.fn<() => Promise<bigint>>()
const mockGetBuyQuote = vi.fn<() => Promise<bigint>>()

vi.mock('viem/tempo', () => ({
  Actions: {
    token: {
      getBalance: (..._args: unknown[]) => mockGetBalance(),
    },
    dex: {
      getBuyQuote: (..._args: unknown[]) => mockGetBuyQuote(),
    },
  },
}))

// Import after mock setup
const { resolveSettlement } = await import('./Charge.js')

const account = { address: '0x1111111111111111111111111111111111111111' as `0x${string}` }
const client = {} as Parameters<typeof resolveSettlementType>[0]['client']

const tokenA = '0xAAAA000000000000000000000000000000000000' as const
const tokenB = '0xBBBB000000000000000000000000000000000000' as const

describe('resolveSettlement', () => {
  test('direct: picks first settlement token with sufficient balance', async () => {
    mockGetBalance.mockResolvedValueOnce(1_000_000n) // tokenA balance

    const result = await resolveSettlement({
      client,
      account,
      amount: 1_000_000n,
      settlementCurrencies: [tokenA, tokenB],
    })

    expect(result).toEqual<SettlementResolution>({
      type: 'direct',
      token: tokenA,
    })
  })

  test('direct: skips token with insufficient balance', async () => {
    mockGetBalance
      .mockResolvedValueOnce(500n) // tokenA: insufficient
      .mockResolvedValueOnce(1_000_000n) // tokenB: sufficient

    const result = await resolveSettlement({
      client,
      account,
      amount: 1_000_000n,
      settlementCurrencies: [tokenA, tokenB],
    })

    expect(result).toEqual<SettlementResolution>({
      type: 'direct',
      token: tokenB,
    })
  })

  test('direct: skips token with dust balance (less than amount)', async () => {
    mockGetBalance
      .mockResolvedValueOnce(1n) // tokenA: dust
      .mockResolvedValueOnce(0n) // tokenB: zero
      // Falls through to swap path — known USD tokens
      .mockResolvedValueOnce(2_000_000n) // usdc: sufficient

    mockGetBuyQuote.mockResolvedValueOnce(1_000_000n) // quoted amount

    const result = await resolveSettlement({
      client,
      account,
      amount: 1_000_000n,
      settlementCurrencies: [tokenA, tokenB],
    })

    expect(result.type).toBe('swap')
  })

  test('swap: uses DEX quote for maxAmountIn', async () => {
    mockGetBalance
      .mockResolvedValueOnce(0n) // tokenA: zero
      .mockResolvedValueOnce(5_000_000n) // usdc: sufficient

    mockGetBuyQuote.mockResolvedValueOnce(1_000_500n) // quoted: slightly above 1:1

    const result = await resolveSettlement({
      client,
      account,
      amount: 1_000_000n,
      settlementCurrencies: [tokenA],
    })

    expect(result).toEqual<SettlementResolution>({
      type: 'swap',
      heldToken: expect.stringMatching(/^0x/) as `0x${string}`,
      targetToken: tokenA,
      maxAmountIn: 1_000_500n,
    })
  })

  test('swap: throws on insufficient balance for quoted amount', async () => {
    mockGetBalance
      .mockResolvedValueOnce(0n) // tokenA: zero
      .mockResolvedValueOnce(500n) // usdc: less than quote

    mockGetBuyQuote.mockResolvedValueOnce(1_000_000n) // need 1M but only have 500

    await expect(
      resolveSettlement({
        client,
        account,
        amount: 1_000_000n,
        settlementCurrencies: [tokenA],
      }),
    ).rejects.toThrow('Insufficient balance')
  })

  test('swap: throws on DEX liquidity failure', async () => {
    mockGetBalance
      .mockResolvedValueOnce(0n) // tokenA: zero
      .mockResolvedValueOnce(5_000_000n) // usdc: has balance

    mockGetBuyQuote.mockRejectedValueOnce(new Error('INSUFFICIENT_LIQUIDITY'))

    await expect(
      resolveSettlement({
        client,
        account,
        amount: 1_000_000n,
        settlementCurrencies: [tokenA],
      }),
    ).rejects.toThrow('Insufficient DEX liquidity')
  })

  test('throws when no USD tokens available', async () => {
    mockGetBalance
      .mockResolvedValueOnce(0n) // tokenA: zero
      .mockResolvedValueOnce(0n) // usdc: zero
      .mockResolvedValueOnce(0n) // pathUsd: zero

    await expect(
      resolveSettlement({
        client,
        account,
        amount: 1_000_000n,
        settlementCurrencies: [tokenA],
      }),
    ).rejects.toThrow('No USD tokens available for settlement')
  })

  test('swap: skips known tokens already in settlementCurrencies', async () => {
    // pathUsd is in settlementCurrencies, so it's already checked in the direct pass.
    // It should not be checked again in the swap pass.
    const pathUsd = '0x20c0000000000000000000000000000000000000'

    mockGetBalance
      .mockResolvedValueOnce(0n) // pathUsd in settlement: insufficient
      .mockResolvedValueOnce(5_000_000n) // usdc (known): sufficient

    mockGetBuyQuote.mockResolvedValueOnce(1_000_000n)

    const result = await resolveSettlement({
      client,
      account,
      amount: 1_000_000n,
      settlementCurrencies: [pathUsd],
    })

    // Should pick usdc for swap (pathUsd was already checked in direct pass)
    expect(result.type).toBe('swap')
    expect((result as { heldToken: string }).heldToken.toLowerCase()).toBe(
      '0x20C000000000000000000000b9537d11c60E8b50'.toLowerCase(),
    )
  })
})
