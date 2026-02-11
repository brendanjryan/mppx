import { charge as charge_ } from './Charge.js'
import { sessionManager as sessionManager_ } from './SessionManager.js'
import { session as session_ } from './Session.js'

/**
 * Creates both Tempo `charge` and `session` client method intents from shared parameters.
 *
 * @example
 * ```ts
 * import { Mpay, tempo } from 'mpay/client'
 *
 * const mpay = Mpay.create({
 *   methods: [tempo({ account })],
 * })
 * ```
 */
export function tempo(parameters: tempo.Parameters = {}) {
  return [tempo.charge(parameters), tempo.session(parameters)] as const
}

export namespace tempo {
  export type Parameters = charge_.Parameters & session_.Parameters

  /** Creates a Tempo `charge` client method intent for one-time TIP-20 token transfers. */
  export const charge = charge_
  /** Creates a client-side streaming session for managing payment channels. */
  export const sessionManager = sessionManager_
  /** Creates a Tempo `session` client method intent for streaming TIP-20 token payments. */
  export const session = session_
}
