import * as Transport from '../../server/Transport.js'
import type { Storage } from '../stream/Storage.js'
import { channelStorage as toChannelStorage } from '../stream/Storage.js'
import * as Ws from '../stream/Ws.js'

/**
 * Creates a WebSocket transport for server-side metered streaming payments.
 *
 * This transport is analogous to {@link sseTransport} but operates over
 * WebSocket connections instead of SSE. The transport:
 *
 * - Uses the standard HTTP transport for initial challenge/credential exchange
 *   (the WebSocket upgrade happens after the initial 402 → credential flow)
 * - When `respondReceipt` receives an async generator, it runs the `Ws.serve()`
 *   metering loop which sends JSON-framed messages over the WebSocket via `send`
 * - Mid-stream voucher updates arrive as `payment-credential` messages on the
 *   WebSocket (no separate HTTP POST needed, unlike SSE)
 *
 * @example
 * ```ts
 * import { Mpay, tempo } from 'mpay/server'
 *
 * const storage = tempo.memoryStorage()
 *
 * const mpay = Mpay.create({
 *   methods: [tempo.session({ storage, ... })],
 *   transport: tempo.wsTransport({ storage }),
 * })
 * ```
 */
export function wsTransport(config: wsTransport.Config) {
  const { storage: rawStorage, pollIntervalMs } = config
  const storage = toChannelStorage(rawStorage)
  const httpTransport = Transport.http()

  let lastContext: Ws.FromCredential | null = null

  return Transport.from<
    Request,
    Response,
    | Response
    | {
        send: (data: string) => void
        generate: AsyncIterable<string> | ((stream: Ws.StreamController) => AsyncIterable<string>)
        signal?: AbortSignal | undefined
      }
  >({
    name: 'ws',

    getCredential(request) {
      const credential = httpTransport.getCredential(request)
      if (credential) {
        try {
          const header = request.headers.get('Authorization')
          if (header) lastContext = Ws.fromCredential(header)
        } catch {
          lastContext = null
        }
      }
      return credential
    },

    respondChallenge(options) {
      return httpTransport.respondChallenge(options)
    },

    respondReceipt({ receipt, response, challengeId }) {
      if (isWsResponse(response)) {
        if (!lastContext)
          throw new Error('No WebSocket context available — credential was not parsed')

        const generate = response.generate
        const sendFn = response.send

        Ws.serve({
          storage,
          channelId: lastContext.channelId,
          challengeId,
          tickCost: lastContext.tickCost,
          generate: generate as Ws.serve.Options['generate'],
          send: sendFn,
          pollIntervalMs,
          signal: response.signal,
        })

        return new Response(null, { status: 101 })
      }

      return httpTransport.respondReceipt({ receipt, response: response as Response, challengeId })
    },
  })
}

export declare namespace wsTransport {
  type Config = {
    storage: Storage
    pollIntervalMs?: number | undefined
  }
}

function isWsResponse(value: unknown): value is {
  send: (data: string) => void
  generate: AsyncIterable<string> | ((stream: Ws.StreamController) => AsyncIterable<string>)
  signal?: AbortSignal | undefined
} {
  if (value === null || typeof value !== 'object') return false
  return (
    'send' in value &&
    'generate' in value &&
    typeof (value as { send: unknown }).send === 'function'
  )
}
