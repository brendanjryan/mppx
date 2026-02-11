import type { Address, Hex } from 'viem'
import type { SignedVoucher } from './Types.js'

/**
 * Generic key-value storage interface.
 *
 * Implementations map string keys to string values and can be backed by
 * any persistence layer (in-memory Map, localStorage, Cloudflare KV, D1,
 * Durable Objects, etc.). This is the user-facing storage type — callers
 * pass a `Storage` and mpay wraps it internally with {@link channelStorage}
 * to produce the richer {@link ChannelStorage} needed by server handlers.
 *
 * Modeled after the Wagmi `Storage` interface for cross-environment
 * compatibility.
 */
export interface Storage {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

/**
 * State for an on-chain payment channel, including per-session accounting.
 *
 * Tracks the channel's identity, on-chain balance, the highest voucher
 * the server has accepted, and the current session's spend counters.
 * A channel is created when a payer opens an escrow on-chain and persists
 * until the channel is finalized (closed/settled).
 *
 * One channel = one session. The client owns the key and can't race with
 * itself, so concurrent session support is unnecessary.
 *
 * Monotonicity invariants (enforced by update callbacks):
 * - `highestVoucherAmount` only increases
 * - `settledOnChain` only increases
 * - `deposit` reflects the latest on-chain value
 */
export interface ChannelState {
  channelId: Hex
  payer: Address
  payee: Address
  token: Address
  authorizedSigner: Address

  /** Current on-chain deposit in the escrow contract. */
  deposit: bigint
  /** Cumulative amount settled on-chain so far. */
  settledOnChain: bigint
  /** Highest cumulative voucher amount accepted by the server. */
  highestVoucherAmount: bigint
  /** The signed voucher corresponding to `highestVoucherAmount`. */
  highestVoucher: SignedVoucher | null

  /** Cumulative amount spent (charged) against this channel's current session. */
  spent: bigint
  /** Number of charge operations (API requests) fulfilled in the current session. */
  units: number

  /** Whether the channel has been finalized (closed) on-chain. */
  finalized: boolean
  createdAt: Date
}

/**
 * Internal storage interface for channel state persistence.
 *
 * ## Atomicity contract
 *
 * The `updateChannel` method uses an atomic read-modify-write callback.
 * The callback receives the current state (or `null` if none exists), and
 * returns the next state (or `null` to delete). Implementations must
 * guarantee that no concurrent mutation occurs between reading `current`
 * and writing the return value.
 *
 * Backends implement this via their native mechanisms:
 * - **In-memory / JS single-thread**: Synchronous callback execution
 * - **Durable Objects**: Single-threaded execution model
 * - **D1 / SQL**: Database transactions
 */
export interface ChannelStorage {
  getChannel(channelId: Hex): Promise<ChannelState | null>

  /**
   * Atomic read-modify-write for channel state.
   * Return `null` from `fn` to delete the channel.
   */
  updateChannel(
    channelId: Hex,
    fn: (current: ChannelState | null) => ChannelState | null,
  ): Promise<ChannelState | null>

  /**
   * Wait for the next update to a channel.
   *
   * Returns a `Promise` that resolves once `updateChannel` is called for
   * `channelId`. Implementations should resolve immediately if the channel
   * was updated between the call to `waitForUpdate` and the `Promise`
   * being awaited.
   *
   * When not implemented, callers fall back to polling.
   */
  waitForUpdate?(channelId: Hex): Promise<void>
}

export type DeductResult =
  | { ok: true; channel: ChannelState }
  | { ok: false; channel: ChannelState }

/**
 * Atomically deduct `amount` from a channel's available balance.
 *
 * Returns `{ ok: true, channel }` if the deduction succeeded, or
 * `{ ok: false, channel }` with the unchanged state if balance is
 * insufficient. Throws if the channel does not exist.
 */
export async function deductFromChannel(
  storage: ChannelStorage,
  channelId: Hex,
  amount: bigint,
): Promise<DeductResult> {
  let deducted = false
  const channel = await storage.updateChannel(channelId, (current) => {
    deducted = false
    if (!current) return null
    if (current.highestVoucherAmount - current.spent >= amount) {
      deducted = true
      return { ...current, spent: current.spent + amount, units: current.units + 1 }
    }
    return current
  })
  if (!channel) throw new Error('channel not found')
  return { ok: deducted, channel }
}

const bigintFields = new Set(['deposit', 'settledOnChain', 'highestVoucherAmount', 'spent'])

function serialize(state: ChannelState): string {
  return JSON.stringify(state, (_key, value) => {
    if (typeof value === 'bigint') return `__bigint:${value.toString()}`
    if (value instanceof Date) return `__date:${value.toISOString()}`
    return value
  })
}

function deserialize(raw: string): ChannelState {
  return JSON.parse(raw, (key, value) => {
    if (typeof value === 'string') {
      if (value.startsWith('__bigint:')) return BigInt(value.slice(9))
      if (value.startsWith('__date:')) return new Date(value.slice(7))
    }
    if (bigintFields.has(key) && typeof value === 'number') return BigInt(value)
    return value
  })
}

/**
 * Wraps a generic {@link Storage} into the internal {@link ChannelStorage}
 * interface used by server handlers and the SSE metering loop.
 *
 * Handles JSON serialization of {@link ChannelState} (including bigint and
 * Date fields) and provides `waitForUpdate` notifications so the SSE
 * `chargeOrWait` loop can wake up without polling.
 */
export function channelStorage(storage: Storage): ChannelStorage {
  const waiters = new Map<string, Set<() => void>>()

  function notify(channelId: string) {
    const set = waiters.get(channelId)
    if (!set) return
    for (const resolve of set) resolve()
    waiters.delete(channelId)
  }

  return {
    async getChannel(channelId) {
      const raw = await storage.get(channelId)
      if (!raw) return null
      return deserialize(raw)
    },
    async updateChannel(channelId, fn) {
      const raw = await storage.get(channelId)
      const current = raw ? deserialize(raw) : null
      const next = fn(current)
      if (next) await storage.set(channelId, serialize(next))
      else await storage.delete(channelId)
      notify(channelId)
      return next
    },
    waitForUpdate(channelId) {
      return new Promise<void>((resolve) => {
        let set = waiters.get(channelId)
        if (!set) {
          set = new Set()
          waiters.set(channelId, set)
        }
        set.add(resolve)
      })
    },
  }
}

/** In-memory storage backed by a simple Map. Useful for development and testing. */
export function memoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    async get(key) {
      return store.get(key) ?? null
    },
    async set(key, value) {
      store.set(key, value)
    },
    async delete(key) {
      store.delete(key)
    },
  }
}
