import { once } from 'node:events'
import { createServer, type Server } from 'node:http'

import { Constants as MppConstants, Credential, Method, Receipt, z } from 'mppx'
import * as Attestation from 'mppx/attestation'
import * as Tap from 'mppx/attestation/tap'
import * as WebBotAuth from 'mppx/attestation/web-bot-auth'
import { Fetch } from 'mppx/client'
import { Mppx, Request as ServerRequest } from 'mppx/server'
import { serializeDictionary } from 'structured-headers'

/** Local paths used to test valid and deliberately modified TAP requests. */
const Paths = {
  /** Endpoint protected by TAP payment-intent evidence. */
  tapPayment: '/tap/payment',
  /** TAP-protected endpoint used to demonstrate signed-path binding. */
  tapOther: '/tap/other',
  /** Endpoint protected by Web Bot Auth identity evidence. */
  webBotAuthPayment: '/web-bot-auth/payment',
} as const

/** Key identifier configured for the temporary TAP signer and verifier. */
const tapKeyId = 'sandbox-tap-agent'

/** Key identifier configured for the temporary Web Bot Auth signer and verifier. */
const webBotAuthKeyId = 'sandbox-webbot-agent'

/** HTTPS key-directory URI advertised by the temporary Web Bot Auth client. */
const signatureAgent = 'https://sandbox.agent.example/keys'

/** Different key-directory URI used to demonstrate signed-header tamper rejection. */
const alteredSignatureAgent = 'https://attacker.example/keys'

/** Minimal payment method that makes the sandbox deterministic and wallet-free. */
const method = Method.from({
  name: 'sandbox',
  intent: 'charge',
  schema: {
    credential: { payload: z.object({ token: z.string() }) },
    request: z.object({ amount: z.string(), currency: z.string(), recipient: z.string() }),
  },
})

/** Client-side payment proof emitted after the server returns a 402 challenge. */
const clientMethod = Method.toClient(method, {
  async createCredential({ challenge }) {
    return Credential.serialize({ challenge, payload: { token: 'sandbox-paid' } })
  },
})

/** Server-side payment verifier that accepts only the sandbox payment proof. */
const serverMethod = Method.toServer(method, {
  async verify({ credential }) {
    if (credential.payload.token !== 'sandbox-paid') throw new Error('Sandbox payment is invalid.')
    return Receipt.from({
      method: 'sandbox',
      reference: 'sandbox-payment',
      status: 'success',
      timestamp: new Date().toISOString(),
    })
  },
})

/** Payment challenge offered by both protected sandbox routes. */
const charge = {
  amount: '1',
  currency: 'USD',
  expires: new Date(Date.now() + 60_000).toISOString(),
  recipient: 'sandbox-merchant',
} as const

/** Temporary key pair shared by the TAP sandbox signer and verifier. */
const tapKeys = await keyPair()

/** Temporary key pair shared by the Web Bot Auth sandbox signer and verifier. */
const webBotAuthKeys = await keyPair()

/** Ordered record of requests that passed attestation and reached MPPX. */
const trace: string[] = []

/** MPPX handler configured with the sandbox's deterministic payment method. */
const payments = Mppx.create({
  methods: [serverMethod],
  realm: 'mppx-attestation-sandbox',
  secretKey: 'sandbox-secret-key-sandbox-secret-key',
})

/** Route handler requiring TAP's payment-intent evidence. */
const tapHandler = Attestation.Server.middleware(paymentHandler(Tap.Constants.protocol), {
  policy: Tap.Policy.requireIntent(Tap.Constants.intents.payment),
  verifiers: {
    [Tap.Constants.protocol]: Tap.Server.verifier({
      keyResolver: ({ keyId }) => (keyId === tapKeyId ? tapKeys.publicKey : undefined),
    }),
  },
})

/** Route handler requiring Web Bot Auth's identity, binding, and replay evidence. */
const webBotAuthHandler = Attestation.Server.middleware(
  paymentHandler(WebBotAuth.Constants.protocol),
  {
    policy: Attestation.Policy.requireCapabilities([
      Attestation.Capabilities.agentIdentity,
      Attestation.Capabilities.requestBinding,
      Attestation.Capabilities.replayProtection,
    ]),
    verifiers: {
      [WebBotAuth.Constants.protocol]: WebBotAuth.Server.verifier({
        keyResolver: ({ keyId, signatureAgent: advertisedAgent }) =>
          keyId === webBotAuthKeyId && advertisedAgent === signatureAgent
            ? webBotAuthKeys.publicKey
            : undefined,
      }),
    },
  },
)

/** Temporary Node HTTP server that dispatches requests to the protocol-specific handlers. */
const server = createServer(
  ServerRequest.toNodeListener(async (request) => {
    switch (new URL(request.url).pathname) {
      case Paths.tapPayment:
      case Paths.tapOther:
        return tapHandler(request)
      case Paths.webBotAuthPayment:
        return webBotAuthHandler(request)
      default:
        return new Response('Not found.', { status: 404 })
    }
  }),
)

try {
  const origin = await listen(server)
  console.log(`[sandbox] Server: ${origin}`)

  await runTAP(origin)
  await runWebBotAuth(origin)
  await runNegativeCases(origin)

  console.log('\n[sandbox] Verified request trace:')
  for (const entry of trace) console.log(`  ${entry}`)
  console.log('\n[sandbox] All TAP and Web Bot Auth checks passed.')
} finally {
  await close(server)
}

/** Runs the full TAP payment challenge and automatically signed MPP retry. */
async function runTAP(origin: string): Promise<void> {
  const fetch = Fetch.from({
    fetch: Tap.Client.wrapFetch(globalThis.fetch, {
      intent: Tap.Constants.intents.payment,
      key: tapKeys.privateKey,
      keyId: tapKeyId,
    }),
    methods: [clientMethod],
  })
  const response = await fetch(new URL(Paths.tapPayment, origin))
  await expectStatus('TAP payment retry', response, 200)
  expectReceipt('TAP payment retry', response)
  console.log('[sandbox] TAP payment intent: 402 challenge → signed retry → 200 receipt')
}

/** Runs the full Web Bot Auth payment challenge and automatically signed MPP retry. */
async function runWebBotAuth(origin: string): Promise<void> {
  const signer = WebBotAuth.Client.signer({
    key: webBotAuthKeys.privateKey,
    keyId: webBotAuthKeyId,
    signatureAgent,
  })
  const signed = await signer.sign(new Request(new URL(Paths.webBotAuthPayment, origin)))
  expectWebBotAuthWireShape(signed)
  const fetch = Fetch.from({
    fetch: WebBotAuth.Client.wrapFetch(globalThis.fetch, {
      key: webBotAuthKeys.privateKey,
      keyId: webBotAuthKeyId,
      signatureAgent,
    }),
    methods: [clientMethod],
  })
  const response = await fetch(new URL(Paths.webBotAuthPayment, origin))
  await expectStatus('Web Bot Auth payment retry', response, 200)
  expectReceipt('Web Bot Auth payment retry', response)
  console.log('[sandbox] Web Bot Auth identity: 402 challenge → signed retry → 200 receipt')
}

/** Exercises policy separation, replay protection, and signature component binding. */
async function runNegativeCases(origin: string): Promise<void> {
  const tapSigner = Tap.Client.signer({
    intent: Tap.Constants.intents.payment,
    key: tapKeys.privateKey,
    keyId: tapKeyId,
  })
  const webBotAuthSigner = WebBotAuth.Client.signer({
    key: webBotAuthKeys.privateKey,
    keyId: webBotAuthKeyId,
    signatureAgent,
  })

  const webBotAuthOnTap = await webBotAuthSigner.sign(
    new Request(new URL(Paths.tapPayment, origin)),
  )
  await expectStatus(
    'Web Bot Auth used as TAP payment intent',
    await globalThis.fetch(webBotAuthOnTap),
    403,
  )

  const replay = await tapSigner.sign(new Request(new URL(Paths.tapPayment, origin)))
  await expectStatus('first TAP nonce use', await globalThis.fetch(replay.clone()), 402)
  await expectStatus('replayed TAP nonce', await globalThis.fetch(replay.clone()), 401)

  const tapPath = await tapSigner.sign(new Request(new URL(Paths.tapPayment, origin)))
  await expectStatus(
    'TAP path modification',
    await globalThis.fetch(
      new Request(new URL(Paths.tapOther, origin), { headers: tapPath.headers }),
    ),
    401,
  )

  const malformedTap = await tapSigner.sign(new Request(new URL(Paths.tapPayment, origin)))
  const malformedHeaders = new Headers(malformedTap.headers)
  malformedHeaders.set(
    Attestation.Headers.signatureInput,
    malformedHeaders
      .get(Attestation.Headers.signatureInput)!
      .replace('alg="ed25519"', 'alg="invalid"'),
  )
  await expectStatus(
    'malformed tagged TAP signature',
    await globalThis.fetch(new Request(malformedTap, { headers: malformedHeaders })),
    401,
  )

  const webBotAuthHeader = await webBotAuthSigner.sign(
    new Request(new URL(Paths.webBotAuthPayment, origin)),
  )
  const headers = new Headers(webBotAuthHeader.headers)
  headers.set(
    WebBotAuth.Constants.signatureAgentHeader,
    serializeDictionary(
      new Map([[WebBotAuth.Constants.label, [alteredSignatureAgent, new Map()] as const]]),
    ),
  )
  await expectStatus(
    'Web Bot Auth Signature-Agent modification',
    await globalThis.fetch(new Request(webBotAuthHeader, { headers })),
    401,
  )

  console.log(
    '[sandbox] Negative checks: policy separation, replay, path, malformed input, and header tampering rejected',
  )
}

/** Creates a protected handler that records only cryptographically verified requests. */
function paymentHandler(protocol: string): Attestation.RequestHandler {
  return async (request) => {
    const paymentRetry = request.headers.has(MppConstants.Headers.authorization)
    trace.push(`${protocol} ${paymentRetry ? 'payment retry' : 'initial request'}`)
    const result = await payments.charge(charge)(request)
    return result.status === 402
      ? result.challenge
      : result.withReceipt(new Response('sandbox-paid'))
  }
}

/** Starts the temporary server on an OS-assigned loopback port. */
async function listen(server: Server): Promise<string> {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('Sandbox server did not receive a TCP port.')
  return `http://127.0.0.1:${address.port}`
}

/** Closes the temporary TCP server, including after any failed assertion. */
async function close(server: Server): Promise<void> {
  if (!server.listening) return
  server.close()
  await once(server, 'close')
}

/** Generates the one-use Ed25519 signing key pair used by a sandbox protocol adapter. */
async function keyPair(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
}

/** Fails the sandbox with an explicit protocol step when an HTTP status differs. */
async function expectStatus(step: string, response: Response, status: number): Promise<void> {
  if (response.status === status) return
  throw new Error(
    `${step} returned ${response.status}, expected ${status}: ${await response.text()}`,
  )
}

/** Ensures a successful MPPX payment response included its settlement receipt. */
function expectReceipt(step: string, response: Response): void {
  if (response.headers.has(MppConstants.Headers.paymentReceipt)) return
  throw new Error(`${step} did not include a payment receipt.`)
}

/** Confirms the signed Web Bot Auth request uses the current dictionary-based wire format. */
function expectWebBotAuthWireShape(request: Request): void {
  const header = request.headers.get(WebBotAuth.Constants.signatureAgentHeader)
  if (header !== `${WebBotAuth.Constants.label}="${signatureAgent}"`)
    throw new Error(`Unexpected Signature-Agent header: ${header ?? '(missing)'}.`)
  if (
    !request.headers
      .get(Attestation.Headers.signatureInput)
      ?.includes(`"signature-agent";key="${WebBotAuth.Constants.label}"`)
  )
    throw new Error('Web Bot Auth did not bind the Signature-Agent dictionary member.')
}
