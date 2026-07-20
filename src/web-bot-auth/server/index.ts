import { isInnerList, parseDictionary } from 'structured-headers'

import { Capabilities } from '../../attestation/Constants.js'
import * as HttpMessageSignature from '../../attestation/internal/HttpMessageSignature.js'
import * as Attestation from '../../attestation/Types.js'
import { Constants } from '../Constants.js'
import type * as Types from '../Types.js'

/**
 * Creates a verifier for Web Bot Auth request signatures.
 *
 * Web Bot Auth confirms the cryptographic identity of an automated HTTP
 * client. It must not be used on its own as user or payment authorization.
 */
export function verifier(config: verifier.Config): Attestation.Verifier<Types.Evidence> {
  const nonceStore = config.nonceStore ?? HttpMessageSignature.createNonceStore()
  return {
    async verify(request) {
      let signatureAgent: string | undefined
      const result = await HttpMessageSignature.verify(request, {
        async keyResolver(parameters) {
          return config.keyResolver({ ...parameters, signatureAgent: signatureAgent! })
        },
        maxAge: Constants.signatureLifetime,
        nonceStore,
        requiredComponents: Constants.requiredComponents,
        tag: Constants.tag,
        validate(_input, input) {
          const component = _input.components.find(
            (entry) => entry.id === HttpMessageSignature.Constants.components.signatureAgent,
          )
          const key = component?.parameters?.get('key')
          if (typeof key !== 'string')
            return 'The signed Signature-Agent component must identify a dictionary member.'
          const value = input.headers.get(Constants.signatureAgentHeader)
          if (!value) return 'The Signature-Agent header is required.'
          let agents
          try {
            agents = parseDictionary(value)
          } catch {
            return 'The Signature-Agent header must be a structured dictionary.'
          }
          const agent = agents.get(key)
          if (!agent || isInnerList(agent) || typeof agent[0] !== 'string')
            return 'The signed Signature-Agent member must be an HTTPS URL.'
          const url = agent[0]
          if (!url.startsWith('https://')) return 'The Signature-Agent header must use HTTPS.'
          signatureAgent = url
          return undefined
        },
      })
      if (!result.input)
        return result.reason ? { status: 'invalid', reason: result.reason } : { status: 'absent' }
      return {
        status: 'verified',
        evidence: {
          protocol: Constants.protocol,
          capabilities: [
            Capabilities.agentIdentity,
            Capabilities.requestBinding,
            Capabilities.replayProtection,
          ],
          value: {
            keyId: result.input.keyId,
            nonce: result.input.nonce,
            signatureAgent: signatureAgent!,
          },
        },
      }
    },
  }
}

export declare namespace verifier {
  type Config = {
    /** Resolves a Web Bot Auth public key for the bot's advertised key directory. */
    keyResolver: (parameters: {
      keyId: string
      request: Request
      signatureAgent: string
    }) => Promise<CryptoKey | undefined> | CryptoKey | undefined
    /** Atomically consumes each nonce in shared storage for multi-instance deployments. */
    nonceStore?: HttpMessageSignature.NonceStore | undefined
  }
}
