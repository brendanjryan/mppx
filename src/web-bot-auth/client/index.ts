import { serializeDictionary } from 'structured-headers'

import * as Attestation from '../../attestation/Client.js'
import * as HttpMessageSignature from '../../attestation/internal/HttpMessageSignature.js'
import type * as AttestationTypes from '../../attestation/Types.js'
import { Constants } from '../Constants.js'

/**
 * Creates a Web Bot Auth request signer.
 *
 * The signed `Signature-Agent` header links the request to an HTTPS key
 * directory. It establishes bot identity only; it does not assert consumer
 * identity or authority to make a payment.
 */
export function signer(config: signer.Config): AttestationTypes.Signer<typeof Constants.protocol> {
  const label = config.label ?? Constants.label
  const signatureAgentKey = config.signatureAgentKey ?? label
  return {
    protocol: Constants.protocol,
    sign(request) {
      const headers = new Headers(request.headers)
      headers.set(
        Constants.signatureAgentHeader,
        serializeDictionary(
          new Map([[signatureAgentKey, [config.signatureAgent, new Map()] as const]]),
        ),
      )
      return HttpMessageSignature.sign(new Request(request, { headers }), {
        components: [
          HttpMessageSignature.Constants.components.authority,
          {
            id: HttpMessageSignature.Constants.components.signatureAgent,
            parameters: new Map([['key', signatureAgentKey]]),
          },
        ],
        expiresIn: config.expiresIn ?? Constants.signatureLifetime,
        key: config.key,
        keyId: config.keyId,
        label,
        tag: Constants.tag,
      })
    },
  }
}

export declare namespace signer {
  type Config = {
    /** Ed25519 private key registered for the bot. */
    key: CryptoKey
    /** RFC 7638 JWK thumbprint for the registered public key. */
    keyId: string
    /** HTTPS key-directory URI, sent as the signed `Signature-Agent` header. */
    signatureAgent: string
    /** Dictionary member name used for `Signature-Agent`. @default signature label */
    signatureAgentKey?: string | undefined
    /** Signature lifetime in seconds. @default 60 */
    expiresIn?: number | undefined
    /** RFC 9421 dictionary label. @default 'webbot' */
    label?: string | undefined
  }
}

/** Wraps a fetch implementation with a Web Bot Auth signer. */
export function wrapFetch(
  fetch: typeof globalThis.fetch,
  config: signer.Config,
): typeof globalThis.fetch {
  return Attestation.wrapFetch(fetch, signer(config))
}
