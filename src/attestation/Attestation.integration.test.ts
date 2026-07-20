import type { RequestListener } from 'node:http'

import { Constants as MppConstants, Credential, Method, Receipt, z } from 'mppx'
import * as Attestation from 'mppx/attestation'
import * as Tap from 'mppx/attestation/tap'
import * as WebBotAuth from 'mppx/attestation/web-bot-auth'
import { Fetch } from 'mppx/client'
import { Mppx, Request as ServerRequest } from 'mppx/server'
import { describe, expect, test } from 'vp/test'
import * as Http from '~test/Http.js'

const method = Method.from({
  name: 'test',
  intent: 'charge',
  schema: {
    credential: { payload: z.object({ token: z.string() }) },
    request: z.object({ amount: z.string(), currency: z.string(), recipient: z.string() }),
  },
})

const clientMethod = Method.toClient(method, {
  async createCredential({ challenge }) {
    return Credential.serialize({ challenge, payload: { token: 'paid' } })
  },
})

const serverMethod = Method.toServer(method, {
  async verify({ credential }) {
    if (credential.payload.token !== 'paid') throw new Error('Payment credential is invalid.')
    return Receipt.from({
      method: 'test',
      reference: 'test-payment',
      status: 'success',
      timestamp: new Date().toISOString(),
    })
  },
})

const charge = {
  amount: '1',
  currency: 'USD',
  expires: new Date(Date.now() + 60_000).toISOString(),
  recipient: 'merchant',
} as const

describe('agent attestation with MPP payment retries', () => {
  test('TAP server accepts a freshly signed payment retry', async () => {
    const keys = await keyPair()
    const seen = await createServer({
      policy: Tap.Policy.requireIntent(Tap.Constants.intents.payment),
      verifiers: {
        [Tap.Constants.protocol]: Tap.Server.verifier({
          keyResolver: ({ keyId }) => (keyId === 'tap-agent' ? keys.publicKey : undefined),
        }),
      },
    })

    try {
      const fetch = Fetch.from({
        fetch: Tap.Client.wrapFetch(globalThis.fetch, {
          intent: Tap.Constants.intents.payment,
          key: keys.privateKey,
          keyId: 'tap-agent',
        }),
        methods: [clientMethod],
      })

      const response = await fetch(seen.server.url)
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('paid')
      expect(seen.requests).toEqual([false, true])
      expect(seen.signatureTags).toEqual([Tap.Constants.tags.payment, Tap.Constants.tags.payment])
      expect(seen.remoteAddresses.every((address) => address !== undefined)).toBe(true)
    } finally {
      seen.server.close()
    }
  })

  test('Web Bot Auth server accepts a freshly signed payment retry without treating it as payment intent', async () => {
    const keys = await keyPair()
    const seen = await createServer({
      policy: Attestation.Policy.requireCapabilities([
        Attestation.Capabilities.agentIdentity,
        Attestation.Capabilities.requestBinding,
        Attestation.Capabilities.replayProtection,
      ]),
      verifiers: {
        [WebBotAuth.Constants.protocol]: WebBotAuth.Server.verifier({
          keyResolver: ({ keyId, signatureAgent }) =>
            keyId === 'webbot-agent' && signatureAgent === 'https://agent.example/keys'
              ? keys.publicKey
              : undefined,
        }),
      },
    })

    try {
      const fetch = Fetch.from({
        fetch: WebBotAuth.Client.wrapFetch(globalThis.fetch, {
          key: keys.privateKey,
          keyId: 'webbot-agent',
          signatureAgent: 'https://agent.example/keys',
        }),
        methods: [clientMethod],
      })

      const response = await fetch(seen.server.url)
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('paid')
      expect(seen.requests).toEqual([false, true])
      expect(seen.signatureTags).toEqual([WebBotAuth.Constants.tag, WebBotAuth.Constants.tag])
    } finally {
      seen.server.close()
    }
  })

  test('does not accept Web Bot Auth as a TAP payment-intent assertion', async () => {
    const keys = await keyPair()
    const seen = await createServer({
      policy: Tap.Policy.requireIntent(Tap.Constants.intents.payment),
      verifiers: {
        [WebBotAuth.Constants.protocol]: WebBotAuth.Server.verifier({
          keyResolver: ({ keyId, signatureAgent }) =>
            keyId === 'webbot-agent' && signatureAgent === 'https://agent.example/keys'
              ? keys.publicKey
              : undefined,
        }),
      },
    })

    try {
      const fetch = WebBotAuth.Client.wrapFetch(globalThis.fetch, {
        key: keys.privateKey,
        keyId: 'webbot-agent',
        signatureAgent: 'https://agent.example/keys',
      })
      expect((await fetch(seen.server.url)).status).toBe(403)
      expect(seen.requests).toEqual([])
    } finally {
      seen.server.close()
    }
  })

  test('rejects a replayed TAP request before issuing a second payment challenge', async () => {
    const keys = await keyPair()
    const seen = await createServer({
      policy: Tap.Policy.requireIntent(Tap.Constants.intents.payment),
      verifiers: {
        [Tap.Constants.protocol]: Tap.Server.verifier({
          keyResolver: ({ keyId }) => (keyId === 'tap-agent' ? keys.publicKey : undefined),
        }),
      },
    })

    try {
      const signer = Tap.Client.signer({
        intent: Tap.Constants.intents.payment,
        key: keys.privateKey,
        keyId: 'tap-agent',
      })
      const signed = await signer.sign(new Request(seen.server.url))

      expect((await globalThis.fetch(signed.clone())).status).toBe(402)
      expect((await globalThis.fetch(signed.clone())).status).toBe(401)
    } finally {
      seen.server.close()
    }
  })

  test('allows only one concurrent use of a TAP nonce over the live HTTP server', async () => {
    const keys = await keyPair()
    const seen = await createServer({
      policy: Tap.Policy.requireIntent(Tap.Constants.intents.payment),
      verifiers: {
        [Tap.Constants.protocol]: Tap.Server.verifier({
          keyResolver: ({ keyId }) => (keyId === 'tap-agent' ? keys.publicKey : undefined),
        }),
      },
    })

    try {
      const signer = Tap.Client.signer({
        intent: Tap.Constants.intents.payment,
        key: keys.privateKey,
        keyId: 'tap-agent',
      })
      const signed = await signer.sign(new Request(seen.server.url))
      const responses = await Promise.all([
        globalThis.fetch(signed.clone()),
        globalThis.fetch(signed.clone()),
      ])

      expect(responses.map((response) => response.status).sort()).toEqual([401, 402])
      expect(seen.requests).toEqual([false])
    } finally {
      seen.server.close()
    }
  })

  test('rejects a Web Bot Auth request when its signed Signature-Agent is altered', async () => {
    const keys = await keyPair()
    const seen = await createServer({
      policy: Attestation.Policy.requireCapabilities([Attestation.Capabilities.agentIdentity]),
      verifiers: {
        [WebBotAuth.Constants.protocol]: WebBotAuth.Server.verifier({
          keyResolver: ({ keyId, signatureAgent }) =>
            keyId === 'webbot-agent' && signatureAgent === 'https://agent.example/keys'
              ? keys.publicKey
              : undefined,
        }),
      },
    })

    try {
      const signer = WebBotAuth.Client.signer({
        key: keys.privateKey,
        keyId: 'webbot-agent',
        signatureAgent: 'https://agent.example/keys',
      })
      const signed = await signer.sign(new Request(seen.server.url))
      const headers = new Headers(signed.headers)
      headers.set(WebBotAuth.Constants.signatureAgentHeader, '"https://attacker.example/keys"')

      expect((await globalThis.fetch(new Request(signed, { headers }))).status).toBe(401)
      expect(seen.requests).toEqual([])
    } finally {
      seen.server.close()
    }
  })

  test('rejects a TAP request when its signed path is altered', async () => {
    const keys = await keyPair()
    const seen = await createServer({
      policy: Tap.Policy.requireIntent(Tap.Constants.intents.payment),
      verifiers: {
        [Tap.Constants.protocol]: Tap.Server.verifier({
          keyResolver: ({ keyId }) => (keyId === 'tap-agent' ? keys.publicKey : undefined),
        }),
      },
    })

    try {
      const signer = Tap.Client.signer({
        intent: Tap.Constants.intents.payment,
        key: keys.privateKey,
        keyId: 'tap-agent',
      })
      const signed = await signer.sign(new Request(seen.server.url))
      const alteredUrl = new URL('/different-resource', seen.server.url)

      expect(
        (await globalThis.fetch(new Request(alteredUrl, { headers: signed.headers }))).status,
      ).toBe(401)
      expect(seen.requests).toEqual([])
    } finally {
      seen.server.close()
    }
  })

  test('rejects a malformed tagged TAP signature instead of treating it as absent', async () => {
    const keys = await keyPair()
    const seen = await createServer({
      policy: Attestation.Policy.requireCapabilities([]),
      verifiers: {
        [Tap.Constants.protocol]: Tap.Server.verifier({
          keyResolver: ({ keyId }) => (keyId === 'tap-agent' ? keys.publicKey : undefined),
        }),
      },
    })

    try {
      const signer = Tap.Client.signer({
        intent: Tap.Constants.intents.payment,
        key: keys.privateKey,
        keyId: 'tap-agent',
      })
      const signed = await signer.sign(new Request(seen.server.url))
      const headers = new Headers(signed.headers)
      headers.set(
        Attestation.Headers.signatureInput,
        headers.get(Attestation.Headers.signatureInput)!.replace('alg="ed25519"', 'alg="invalid"'),
      )

      expect((await globalThis.fetch(new Request(signed, { headers }))).status).toBe(401)
      expect(seen.requests).toEqual([])
    } finally {
      seen.server.close()
    }
  })

  test('emits Web Bot Auth Signature-Agent as a signed structured-field member', async () => {
    const keys = await keyPair()
    const signed = await WebBotAuth.Client.signer({
      key: keys.privateKey,
      keyId: 'webbot-agent',
      signatureAgent: 'https://agent.example/keys',
    }).sign(new Request('https://merchant.example/resource'))

    expect(signed.headers.get(WebBotAuth.Constants.signatureAgentHeader)).toBe(
      `${WebBotAuth.Constants.label}="https://agent.example/keys"`,
    )
    expect(signed.headers.get(Attestation.Headers.signatureInput)).toContain(
      `"signature-agent";key="${WebBotAuth.Constants.label}"`,
    )
  })
})

async function createServer<const verifiers extends Attestation.VerifierMap>(
  config: Attestation.Server.middleware.Config<verifiers>,
) {
  const payments = Mppx.create({
    methods: [serverMethod],
    realm: 'localhost',
    secretKey: 'test-secret-key-test-secret-key-32',
  })
  const requests: boolean[] = []
  const remoteAddresses: (string | undefined)[] = []
  const signatureTags: string[] = []

  const handler = Attestation.Server.middleware(async (request) => {
    requests.push(request.headers.has(MppConstants.Headers.authorization))
    signatureTags.push(
      request.headers.get(Attestation.Headers.signatureInput)?.match(/tag="([^"]+)"/)?.[1] ?? '',
    )
    const result = await payments.charge(charge)(request)
    return result.status === 402 ? result.challenge : result.withReceipt(new Response('paid'))
  }, config)
  const listener = ServerRequest.toNodeListener(handler)
  const server = await Http.createServer(((request, response) => {
    remoteAddresses.push(request.socket.remoteAddress)
    return listener(request, response)
  }) as RequestListener)
  return { remoteAddresses, requests, server, signatureTags }
}

async function keyPair(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
}
