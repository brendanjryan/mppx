import type { IncomingMessage, ServerResponse } from 'node:http'
import type { z } from 'zod/mini'
import * as Challenge from '../Challenge.js'
import * as Credential from '../Credential.js'
import type * as MethodIntent from '../MethodIntent.js'
import * as Receipt from '../Receipt.js'
import { type AnyRequest, getHeader, isFetchRequest, send402, sendReceipt } from './http.js'

/**
 * Server-side payment handler.
 */
export type PaymentHandler<
  intents extends Record<string, MethodIntent.MethodIntent> = Record<
    string,
    MethodIntent.MethodIntent
  >,
> = {
  /** Payment method name (e.g., "tempo", "stripe"). */
  method: string
  /** Server realm (e.g., hostname). */
  realm: string
} & {
  [K in keyof intents]: IntentFn<intents[K]>
}

/**
 * Intent function type with overloads for Fetch and Node.js.
 */
export type IntentFn<intent extends MethodIntent.MethodIntent> = {
  /** Fetch API: returns 402 Response or null if verified. */
  (request: Request, options: z.input<intent['schema']['request']>): Promise<Response | null>
  /** Node.js: writes 402 to response or returns null if verified. */
  (
    request: IncomingMessage,
    response: ServerResponse,
    options: z.input<intent['schema']['request']>,
  ): Promise<true | null>
}

/**
 * Creates a server-side payment handler.
 *
 * @example
 * ```ts
 * import { PaymentHandler } from 'mpay/server'
 * import { Intents } from 'mpay/tempo'
 *
 * const payment = PaymentHandler.from({
 *   method: 'tempo',
 *   realm: 'api.example.com',
 *   secretKey: 'my-secret',
 *   intents: {
 *     charge: Intents.charge,
 *     authorize: Intents.authorize,
 *   },
 *   async verify(credential, challenge) {
 *     // Verify the credential and return a receipt
 *     return { status: 'success', timestamp: new Date().toISOString(), reference: '0x...' }
 *   },
 * })
 * ```
 */
export function from<const intents extends Record<string, MethodIntent.MethodIntent>>(
  parameters: from.Parameters<intents>,
): PaymentHandler<intents> {
  const { method, realm, secretKey, intents, verify } = parameters

  const intentFns: Record<string, IntentFn<MethodIntent.MethodIntent>> = {}
  for (const [name, intent] of Object.entries(intents))
    intentFns[name] = intentFn({
      intent,
      realm,
      secretKey,
      verify: verify as never,
    })

  return { method, realm, ...intentFns } as PaymentHandler<intents>
}

export declare namespace from {
  type Parameters<intents extends Record<string, MethodIntent.MethodIntent>> = {
    /** Payment method name (e.g., "tempo", "stripe"). */
    method: string
    /** Server realm (e.g., hostname). */
    realm: string
    /** Secret key for HMAC-bound challenge IDs (required for stateless verification). */
    secretKey: string
    /** Map of intent names to method intents. */
    intents: intents
    /** Verify a credential and return a receipt. */
    verify: VerifyFn<intents>
  }

  type VerifyContext = {
    /** The original request. */
    request: AnyRequest
  }
}

export type VerifyFn<intents extends Record<string, MethodIntent.MethodIntent>> = (
  credential: Credential.Credential<CredentialPayloadUnion<intents>>,
  challenge: Challenge.Challenge<RequestUnion<intents>>,
  context: from.VerifyContext,
) => Receipt.Receipt | Promise<Receipt.Receipt>

/** @internal */
type CredentialPayloadUnion<intents extends Record<string, MethodIntent.MethodIntent>> = {
  [K in keyof intents]: z.output<intents[K]['schema']['credential']['payload']>
}[keyof intents]

/** @internal */
type RequestUnion<intents extends Record<string, MethodIntent.MethodIntent>> = {
  [K in keyof intents]: z.output<intents[K]['schema']['request']>
}[keyof intents]

/** @internal */
function _intentFn<intent extends MethodIntent.MethodIntent>(
  parameters: _intentFn.Parameters<intent>,
): IntentFn<intent> {
  const { intent, realm, secretKey, verify } = parameters

  return async function intentFn(
    request: AnyRequest,
    responseOrOptions: ServerResponse | z.input<intent['schema']['request']>,
    maybeOptions?: z.input<intent['schema']['request']>,
  ): Promise<Response | true | null> {
    const response = isFetchRequest(request) ? undefined : (responseOrOptions as ServerResponse)
    const options = (isFetchRequest(request) ? responseOrOptions : maybeOptions) as z.input<
      intent['schema']['request']
    >

    const challenge = Challenge.fromIntent(intent, {
      secretKey,
      realm,
      request: options,
    })

    const challengeHeader = Challenge.serialize(challenge)

    const authHeader = getHeader(request, 'Authorization')
    if (!authHeader) return send402(challengeHeader, response)

    let credential: Credential.Credential
    try {
      credential = Credential.deserialize(authHeader)
    } catch {
      return send402(challengeHeader, response)
    }

    if (!Challenge.verify(challenge, { secretKey })) return send402(challengeHeader, response)
    if (credential.id !== challenge.id) return send402(challengeHeader, response)

    try {
      intent.schema.credential.payload.parse(credential.payload)
    } catch {
      return send402(challengeHeader, response)
    }

    const receipt = await verify(
      credential as Credential.Credential<z.output<intent['schema']['credential']['payload']>>,
      challenge,
      { request },
    )

    const receiptHeader = Receipt.serialize(receipt)
    sendReceipt(receiptHeader, response)

    return null
  } as IntentFn<intent>
}

declare namespace intentFn {
  type Parameters<intent extends MethodIntent.MethodIntent> = {
    intent: intent
    realm: string
    secretKey: string
    verify: VerifyFn<Record<string, intent>>
  }
}
