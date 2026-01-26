import type { z } from 'zod/mini'
import type * as MethodIntent from './MethodIntent.js'
import * as Request from './Request.js'

/**
 * A parsed payment challenge from a `WWW-Authenticate` header.
 *
 * @example
 * ```ts
 * import { Challenge } from 'mpay'
 *
 * const challenge: Challenge.Challenge = {
 *   id: 'abc123',
 *   realm: 'api.example.com',
 *   method: 'tempo',
 *   intent: 'charge',
 *   request: { amount: '1000000', currency: '0x...', recipient: '0x...' },
 * }
 * ```
 */
export type Challenge<request = unknown> = {
  /** Optional digest of the request body. */
  digest?: string | undefined
  /** Optional expiration timestamp (ISO 8601). */
  expires?: string | undefined
  /** Unique challenge identifier (HMAC-bound). */
  id: string
  /** Intent type (e.g., "charge", "authorize"). */
  intent: string
  /** Payment method (e.g., "tempo", "stripe"). */
  method: string
  /** Server realm (e.g., hostname). */
  realm: string
  /** Method-specific request data. */
  request: request
}

/**
 * Creates a challenge from the given parameters.
 *
 * @param challenge - Challenge parameters.
 * @returns A challenge.
 *
 * @example
 * ```ts
 * import { Challenge } from 'mpay'
 *
 * const challenge = Challenge.from({
 *   id: 'abc123',
 *   realm: 'api.example.com',
 *   method: 'tempo',
 *   intent: 'charge',
 *   request: { amount: '1000000', currency: '0x...', recipient: '0x...' },
 * })
 * ```
 */
export function from<const challenge extends Challenge>(challenge: challenge): challenge {
  return challenge
}

/**
 * Creates a validated challenge from a method intent.
 *
 * @param intent - The method intent to validate against.
 * @param parameters - Challenge parameters (id, realm, request, optional expires/digest).
 * @returns A validated challenge.
 *
 * @example
 * ```ts
 * import { Challenge } from 'mpay'
 * import { Intents } from 'mpay/tempo'
 *
 * const challenge = Challenge.fromIntent(Intents.charge, {
 *   id: 'abc123',
 *   realm: 'api.example.com',
 *   request: {
 *     amount: '1000000',
 *     currency: '0x20c0000000000000000000000000000000000001',
 *     recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00',
 *     expires: '2025-01-06T12:00:00Z',
 *   },
 * })
 * ```
 */
export function fromIntent<const intent extends MethodIntent.MethodIntent>(
  intent: intent,
  parameters: fromIntent.Parameters<intent>,
): Challenge<z.output<intent['schema']['request']>> {
  const request = Request.fromIntent(intent, parameters.request)
  return {
    id: parameters.id,
    realm: parameters.realm,
    method: intent.method,
    intent: intent.name,
    request,
    ...(parameters.digest !== undefined && { digest: parameters.digest }),
    ...(parameters.expires !== undefined && { expires: parameters.expires }),
  }
}

export declare namespace fromIntent {
  type Parameters<intent extends MethodIntent.MethodIntent> = {
    /** Optional digest of the request body. */
    digest?: string | undefined
    /** Optional expiration timestamp (ISO 8601). */
    expires?: string | undefined
    /** Unique challenge identifier. */
    id: string
    /** Server realm (e.g., hostname). */
    realm: string
    /** Method-specific request data. */
    request: z.input<intent['schema']['request']>
  }
}

/**
 * Serializes a challenge to the WWW-Authenticate header format.
 *
 * @param challenge - The challenge to serialize.
 * @returns A string suitable for the WWW-Authenticate header value.
 *
 * @example
 * ```ts
 * import { Challenge } from 'mpay'
 *
 * const header = Challenge.serialize(challenge)
 * // => 'Payment id="abc123", realm="api.example.com", method="tempo", intent="charge", request="eyJhbW91bnQiOi..."'
 * ```
 */
export function serialize(challenge: Challenge<Request.Request>): string {
  const parts = [
    `id="${challenge.id}"`,
    `realm="${challenge.realm}"`,
    `method="${challenge.method}"`,
    `intent="${challenge.intent}"`,
    `request="${Request.serialize(challenge.request)}"`,
  ]

  if (challenge.digest !== undefined) parts.push(`digest="${challenge.digest}"`)
  if (challenge.expires !== undefined) parts.push(`expires="${challenge.expires}"`)

  return `Payment ${parts.join(', ')}`
}

/**
 * Deserializes a WWW-Authenticate header value to a challenge.
 *
 * @param header - The WWW-Authenticate header value.
 * @returns The deserialized challenge.
 *
 * @example
 * ```ts
 * import { Challenge } from 'mpay'
 *
 * const challenge = Challenge.deserialize(header)
 * ```
 */
export function deserialize(value: string): Challenge {
  const prefixMatch = value.match(/^Payment\s+(.+)$/i)
  if (!prefixMatch?.[1]) throw new Error('Invalid challenge: missing Payment scheme')

  const params = prefixMatch[1]
  const result: Record<string, string> = {}

  for (const match of params.matchAll(/(\w+)="([^"]+)"/g)) {
    const key = match[1]
    const value = match[2]
    if (key && value) result[key] = value
  }

  const { id, realm, method, intent, request, digest, expires } = result
  if (!id) throw new Error('Invalid challenge: missing id')
  if (!realm) throw new Error('Invalid challenge: missing realm')
  if (!method) throw new Error('Invalid challenge: missing method')
  if (!intent) throw new Error('Invalid challenge: missing intent')
  if (!request) throw new Error('Invalid challenge: missing request')

  return {
    id,
    realm,
    method,
    intent,
    request: Request.deserialize(request),
    ...(digest && { digest }),
    ...(expires && { expires }),
  }
}

/**
 * Extracts the challenge from a Response's WWW-Authenticate header.
 *
 * @param response - The HTTP response (must be 402 status).
 * @returns The deserialized challenge.
 *
 * @example
 * ```ts
 * import { Challenge } from 'mpay'
 *
 * const response = await fetch('/resource')
 * if (response.status === 402)
 *   const challenge = Challenge.fromResponse(response)
 * ```
 */
export function fromResponse(response: Response): Challenge {
  if (response.status !== 402) throw new Error(`Expected 402 status, got ${response.status}`)

  const header = response.headers.get('WWW-Authenticate')
  if (!header) throw new Error('Missing WWW-Authenticate header')

  return deserialize(header)
}
