import { VerificationFailedError } from '../../Errors.js'
import type * as Method from '../../Method.js'
import * as Receipt from '../../Receipt.js'

const defaultApiBaseUrl = 'https://api.tempo.xyz'

/** Error body returned by Tempo API's MPP relay. */
type RelayError = {
  /** Stable machine-readable reason the relay rejected the credential. */
  code: string
  /** Human-readable explanation of the relay result. */
  message?: string | undefined
}

/** Challenge and payload accepted by Tempo API's MPP relay. */
type RelayInput = {
  /** Challenge from the submitted credential. */
  challenge: Record<string, unknown>
  /** Method-specific credential payload. */
  payload: unknown
}

/** Response returned by the MPP relay verification endpoint. */
type VerifyResponse = { success: true } | { error: RelayError; success: false }

/** Receipt returned by the MPP relay after broadcast. */
type RelayReceipt = {
  /** Optional caller-provided payment reference. */
  externalId?: string | undefined
  /** Payment method that settled the credential. */
  method: string
  /** On-chain or payment-system settlement reference. */
  reference: string
  /** RFC 3339 settlement timestamp. */
  timestamp: string
}

/** Response returned by the MPP relay broadcast endpoint. */
type BroadcastResponse =
  | { receipt: RelayReceipt; success: true }
  | { error: RelayError; success: false }

/**
 * Configures a Tempo payment method to use Tempo API's MPP relay.
 *
 * The adapter preserves the supplied method's challenge configuration while
 * delegating credential validation and terminal broadcast to
 * `/v1/mpp/verify` and `/v1/mpp/broadcast` respectively.
 *
 * @internal
 */
export function configure<const intent extends Method.Method>(
  method: Method.Server<intent>,
  options: configure.Options,
): configure.Adapter<intent> {
  const request = createRequest(options)

  const validate: Method.ValidateFn<intent> = async (parameters) => {
    const input = toRelayInput(parameters.credential)
    await request.verify(input)

    return {
      challenge: parameters.credential.challenge,
      credential: parameters.credential,
      details: {},
      intent: method.intent,
      method: method.name,
      request: parameters.request,
      ...(parameters.credential.source ? { source: parameters.credential.source } : {}),
    } as Method.Validation<intent>
  }

  const broadcast: Method.BroadcastFn<intent> = async (parameters) => {
    const receipt = await request.broadcast(toRelayInput(parameters.credential), {
      idempotencyKey: `mppx_${parameters.credential.challenge.id}`,
    })
    try {
      return Receipt.from({ ...receipt, status: 'success' })
    } catch {
      throw failure()
    }
  }

  // `verify` is the legacy combined validation and settlement hook. A relay
  // cannot safely implement it: its successful result must be a receipt, which
  // requires broadcast. Keep it inert so direct legacy calls cannot settle a
  // payment unexpectedly; use `validate` and `broadcast` instead.
  const verify: Method.VerifyFn<intent> = async () => {
    throw failure()
  }

  return {
    ...method,
    broadcast,
    verify,
    validate,
  } as configure.Adapter<intent>
}

export declare namespace configure {
  /**
   * Server method augmented with Tempo API validation and broadcast hooks.
   *
   * The inherited `verify` method is legacy-only and always fails without
   * settling. Use `validate` followed by `broadcast` for relay payments.
   */
  type Adapter<intent extends Method.Method> = Omit<
    Method.Server<intent>,
    'broadcast' | 'validate'
  > & {
    /** Broadcasts the credential through Tempo API. */
    broadcast: Method.BroadcastFn<intent>
    /** Validates the credential through Tempo API. */
    validate: Method.ValidateFn<intent>
  }

  /** Tempo API relay configuration for server-side Tempo charges. */
  type Options = {
    /** Tempo API key with the `mpp:write` scope. */
    apiKey: string
    /** Fetch implementation used to call Tempo API. */
    fetch?: typeof globalThis.fetch | undefined
    /** Tempo API base URL. @default 'https://api.tempo.xyz' */
    apiBaseUrl?: string | undefined
  }
}

function createRequest(options: configure.Options) {
  const fetch = options.fetch ?? globalThis.fetch
  const apiBaseUrl = new URL(options.apiBaseUrl ?? defaultApiBaseUrl)

  async function post(
    path: '/v1/mpp/broadcast' | '/v1/mpp/verify',
    input: RelayInput,
    headers?: Record<string, string>,
  ): Promise<unknown> {
    let response: Response
    try {
      response = await fetch(new URL(path, apiBaseUrl), {
        body: JSON.stringify(input),
        headers: {
          Accept: 'application/json',
          'content-type': 'application/json',
          'tempo-api-key': options.apiKey,
          ...headers,
        },
        method: 'POST',
      })
    } catch {
      throw failure()
    }

    if (!response.ok) throw failure()
    return response.json().catch(() => undefined)
  }

  const verify = async (input: RelayInput) => {
    const response = await post('/v1/mpp/verify', input)
    if (!isVerifySuccess(response)) throw failure()
  }

  const broadcast = async (input: RelayInput, options: { idempotencyKey: string }) => {
    const response = await post('/v1/mpp/broadcast', input, {
      'idempotency-key': options.idempotencyKey,
    })
    if (!isBroadcastSuccess(response)) throw failure()
    return response.receipt
  }

  return {
    broadcast,
    verify,
  }
}

function toRelayInput(credential: {
  challenge: Record<string, unknown>
  payload: unknown
}): RelayInput {
  return { challenge: credential.challenge, payload: credential.payload }
}

function failure(): VerificationFailedError {
  return new VerificationFailedError()
}

function isVerifySuccess(value: unknown): value is Extract<VerifyResponse, { success: true }> {
  return isRecord(value) && value.success === true
}

function isBroadcastSuccess(
  value: unknown,
): value is Extract<BroadcastResponse, { success: true }> {
  return isRecord(value) && value.success === true && isRelayReceipt(value.receipt)
}

function isRelayReceipt(value: unknown): value is RelayReceipt {
  return (
    isRecord(value) &&
    typeof value.method === 'string' &&
    typeof value.reference === 'string' &&
    typeof value.timestamp === 'string' &&
    (value.externalId === undefined || typeof value.externalId === 'string')
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
