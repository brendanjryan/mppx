/**
 * WebSocket utilities for metered streaming payments.
 *
 * Provides message formatting/parsing, balance polling, the core
 * `serve()` loop that meters an async iterable and sends messages
 * over a WebSocket, and helpers for building WebSocket handlers.
 *
 * Message format uses JSON with a `type` discriminator:
 * - `{ type: "message", data: string }` — application data
 * - `{ type: "payment-need-voucher", data: NeedVoucherEvent }` — balance exhausted
 * - `{ type: "payment-receipt", data: StreamReceipt }` — final receipt
 * - `{ type: "payment-credential", data: string }` — client credential (voucher)
 */
import type { Hex } from 'viem'
import * as Credential from '../../Credential.js'
import { createStreamReceipt } from './Receipt.js'
import type { ChannelStorage } from './Storage.js'
import { deductFromChannel } from './Storage.js'
import type { NeedVoucherEvent, StreamCredentialPayload, StreamReceipt } from './Types.js'

export type WsMessage =
  | { type: 'message'; data: string }
  | { type: 'payment-need-voucher'; data: NeedVoucherEvent }
  | { type: 'payment-receipt'; data: StreamReceipt }
  | { type: 'payment-credential'; data: string }

export function formatMessage(data: string): string {
  return JSON.stringify({ type: 'message', data })
}

export function formatNeedVoucherMessage(params: NeedVoucherEvent): string {
  return JSON.stringify({ type: 'payment-need-voucher', data: params })
}

export function formatReceiptMessage(receipt: StreamReceipt): string {
  return JSON.stringify({ type: 'payment-receipt', data: receipt })
}

export function formatCredentialMessage(credential: string): string {
  return JSON.stringify({ type: 'payment-credential', data: credential })
}

export function parseMessage(raw: string): WsMessage | null {
  try {
    const msg = JSON.parse(raw) as WsMessage
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return null
    switch (msg.type) {
      case 'message':
      case 'payment-need-voucher':
      case 'payment-receipt':
      case 'payment-credential':
        return msg
      default:
        return null
    }
  } catch {
    return null
  }
}

export type StreamController = {
  charge(): Promise<void>
}

/**
 * Context extracted from the initial credential message on a WebSocket.
 */
export type FromCredential = {
  challengeId: string
  channelId: Hex
  tickCost: bigint
  credential: string
}

/**
 * Extract `channelId`, `challengeId`, and `tickCost` from a serialized
 * credential string (the `Authorization: Payment …` value).
 */
export function fromCredential(credentialHeader: string): FromCredential {
  const payment = Credential.extractPaymentScheme(credentialHeader)
  if (!payment) throw new Error('Missing Payment credential.')

  const credential = Credential.deserialize(payment)
  const payload = credential.payload as StreamCredentialPayload
  return {
    challengeId: credential.challenge.id,
    channelId: payload.channelId,
    tickCost: BigInt(credential.challenge.request.amount as string),
    credential: credentialHeader,
  }
}

/**
 * Wrap an async iterable with payment metering, sending messages
 * over a WebSocket-like `send` callback.
 *
 * `generate` may be either:
 * - An `AsyncIterable<string>` — each yielded value is automatically charged.
 * - A callback `(stream: StreamController) => AsyncIterable<string>` — the
 *   generator controls when charges happen by calling `stream.charge()`.
 *
 * For each emitted value the loop:
 * 1. Deducts `tickCost` from the channel balance atomically.
 * 2. If balance is sufficient, sends a `message` frame.
 * 3. If balance is exhausted, sends a `payment-need-voucher` message
 *    and polls storage until the client tops up the channel.
 * 4. On generator completion, sends a final `payment-receipt` message.
 *
 * Returns a `Promise` that resolves when the generator is exhausted or
 * the signal is aborted.
 */
export async function serve(options: serve.Options): Promise<void> {
  const {
    storage,
    channelId,
    challengeId,
    tickCost,
    generate,
    send,
    pollIntervalMs = 100,
    signal,
  } = options

  const aborted = () => signal?.aborted ?? false

  const charge = () =>
    chargeOrWait({
      storage,
      channelId,
      amount: tickCost,
      send,
      pollIntervalMs,
      signal,
    })

  const iterable: AsyncIterable<string> =
    typeof generate === 'function' ? generate({ charge }) : generate

  try {
    for await (const value of iterable) {
      if (aborted()) break

      if (typeof generate !== 'function') await charge()

      send(formatMessage(value))
    }

    if (!aborted()) {
      const channel = await storage.getChannel(channelId)
      if (channel) {
        const receipt = createStreamReceipt({
          challengeId,
          channelId,
          acceptedCumulative: channel.highestVoucherAmount,
          spent: channel.spent,
          units: channel.units,
        })
        send(formatReceiptMessage(receipt))
      }
    }
  } catch (e) {
    if (!aborted()) throw e
  }
}

export declare namespace serve {
  type Options = {
    storage: ChannelStorage
    channelId: Hex
    challengeId: string
    tickCost: bigint
    generate: AsyncIterable<string> | ((stream: StreamController) => AsyncIterable<string>)
    send: (data: string) => void
    pollIntervalMs?: number | undefined
    signal?: AbortSignal | undefined
  }
}

async function chargeOrWait(options: {
  storage: ChannelStorage
  channelId: Hex
  amount: bigint
  send: (data: string) => void
  pollIntervalMs: number
  signal?: AbortSignal | undefined
}): Promise<void> {
  const { storage, channelId, amount, send, pollIntervalMs, signal } = options

  let result = await deductFromChannel(storage, channelId, amount)

  while (!result.ok) {
    const requiredCumulative = (result.channel.spent + amount).toString()
    send(
      formatNeedVoucherMessage({
        channelId,
        requiredCumulative,
        acceptedCumulative: result.channel.highestVoucherAmount.toString(),
        deposit: result.channel.deposit.toString(),
      }),
    )

    await waitForUpdate(storage, channelId, pollIntervalMs, signal)
    result = await deductFromChannel(storage, channelId, amount)
  }
}

async function waitForUpdate(
  storage: ChannelStorage,
  channelId: Hex,
  pollIntervalMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw new Error('Aborted while waiting for voucher')
  if (storage.waitForUpdate) {
    await Promise.race([
      storage.waitForUpdate(channelId),
      ...(signal ? [abortPromise(signal)] : []),
    ])
  } else {
    await sleep(pollIntervalMs)
  }
  if (signal?.aborted) throw new Error('Aborted while waiting for voucher')
}

function abortPromise(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    signal.addEventListener('abort', () => resolve(), { once: true })
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
