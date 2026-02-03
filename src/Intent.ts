import * as z from './zod.js'

/**
 * A payment intent.
 */
export type Intent = {
  name: string
  schema: {
    request: z.z.ZodMiniObject
  }
}

/**
 * Creates an intent.
 *
 * @example
 * ```ts
 * import { z } from 'mpay'
 *
 * const charge = Intent.from({
 *   name: 'charge',
 *   schema: {
 *     request: z.object({
 *       amount: z.string(),
 *       currency: z.string(),
 *       recipient: z.optional(z.string()),
 *     }),
 *   },
 * })
 * ```
 */
export function from<const intent extends Intent>(intent: intent): intent {
  return intent
}

/**
 * Charge intent for one-time immediate payments.
 *
 * @see https://github.com/tempoxyz/payment-auth-spec/blob/main/specs/intents/draft-payment-intent-charge-00.md
 */
export const charge = from({
  name: 'charge',
  schema: {
    request: z.object({
      amount: z.amount(),
      currency: z.string(),
      description: z.optional(z.string()),
      expires: z.optional(z.datetime()),
      externalId: z.optional(z.string()),
      recipient: z.optional(z.string()),
    }),
  },
})
