import * as Attestation from '../../attestation/Client.js'
import * as HttpMessageSignature from '../../attestation/internal/HttpMessageSignature.js'
import type * as AttestationTypes from '../../attestation/Types.js'
import { Constants } from '../Constants.js'

/**
 * Creates a TAP request signer.
 *
 * The signer emits RFC 9421 HTTP message signatures with TAP's
 * `agent-browser-auth` or `agent-payer-auth` tag. Use it as the underlying
 * fetch for MPPX so the automatic paid retry is signed too.
 */
export function signer(config: signer.Config): AttestationTypes.Signer<typeof Constants.protocol> {
  const tag =
    config.intent === Constants.intents.payment ? Constants.tags.payment : Constants.tags.browse
  return {
    protocol: Constants.protocol,
    sign(request) {
      return HttpMessageSignature.sign(request, {
        components: Constants.requiredComponents,
        expiresIn: config.expiresIn ?? Constants.defaultSignatureLifetime,
        key: config.key,
        keyId: config.keyId,
        label: config.label ?? Constants.label,
        tag,
      })
    },
  }
}

export declare namespace signer {
  type Config = {
    /** TAP signature type for the request. */
    intent: (typeof Constants.intents)[keyof typeof Constants.intents]
    /** Ed25519 private key provisioned to the agent provider. */
    key: CryptoKey
    /** Identifier the merchant uses to resolve the signing public key. */
    keyId: string
    /** Signature lifetime in seconds. TAP permits at most eight minutes. @default 480 */
    expiresIn?: number | undefined
    /** RFC 9421 dictionary label. @default 'tap' */
    label?: string | undefined
  }
}

/** Wraps a fetch implementation with a TAP signer. */
export function wrapFetch(
  fetch: typeof globalThis.fetch,
  config: signer.Config,
): typeof globalThis.fetch {
  return Attestation.wrapFetch(fetch, signer(config))
}
