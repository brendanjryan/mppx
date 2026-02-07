import type { StreamReceipt } from './Types.js'

/**
 * Format a stream receipt as a Server-Sent Event.
 *
 * Produces a valid SSE event string with `event: payment-receipt`
 * and the receipt JSON as the `data` field.
 */
export function formatReceiptEvent(receipt: StreamReceipt): string {
  return `event: payment-receipt\ndata: ${JSON.stringify(receipt)}\n\n`
}
