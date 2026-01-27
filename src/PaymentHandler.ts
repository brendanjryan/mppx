import type * as MethodIntent from './MethodIntent.js'

export type PaymentHandler<
  method extends string = string,
  intents extends Record<string, MethodIntent.MethodIntent> = Record<
    string,
    MethodIntent.MethodIntent
  >,
> = {
  /** The intents registered with this handler. */
  intents: intents
  /** Payment method name (e.g., "tempo", "stripe"). */
  method: method
  /** Server realm (e.g., hostname). */
  realm: string
}
