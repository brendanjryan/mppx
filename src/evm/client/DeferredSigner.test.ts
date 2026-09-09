import { Credential } from 'mppx'
import { evm as clientEvm, Mppx as ClientMppx } from 'mppx/client'
import { evm, Mppx } from 'mppx/server'
import { Header, Types } from 'mppx/x402'
import type { Account } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, test } from 'vp/test'

const account = privateKeyToAccount(
  '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
)

async function fixture(protocol: 'mpp' | 'x402', configuredAccount?: Account) {
  let settlements = 0
  const server = Mppx.create({
    methods: [
      evm.charge({
        currency: evm.assets.base.USDC,
        recipient: '0x209693Bc6afc0C5328bA36FaF03C514EF312287C',
        x402: {
          facilitator: {
            async verify() {
              return { isValid: true }
            },
            async settle() {
              settlements++
              return { success: true, transaction: `0x${'1'.repeat(64)}`, network: 'eip155:8453' }
            },
          },
        },
      }),
    ],
    realm: 'example.test',
    secretKey: 'test-secret-key-test-secret-key-32',
  })
  const offered = await server.charge({ amount: '0.25' })(new Request('https://example.test/paid'))
  if (offered.status !== 402) throw new Error('Expected a payment offer')
  const response =
    protocol === 'mpp'
      ? offered.challenge
      : new Response(null, {
          status: 402,
          headers: {
            [Types.paymentRequiredHeader]: offered.challenge.headers.get(
              Types.paymentRequiredHeader,
            )!,
          },
        })
  const client = ClientMppx.create({
    methods: [
      clientEvm.charge({
        account: configuredAccount,
        currencies: [clientEvm.assets.base.USDC],
        networks: [8453],
      }),
    ],
    polyfill: false,
  })
  const payment = await client.preparePayment(response)
  function payer(serialized: string) {
    if (protocol === 'x402')
      return (
        Header.decodePaymentSignature(serialized).payload as { authorization: { from: string } }
      ).authorization.from
    return (Credential.deserialize(serialized).payload as { from: string }).from
  }
  return { payment, payer, settlements: () => settlements }
}

describe.each(['mpp', 'x402'] as const)('deferred EVM signer (%s)', (protocol) => {
  test('prepares without an account and signs with the credential context', async () => {
    const context = await fixture(protocol)
    expect(context.settlements()).toBe(0)
    expect(context.payer(await context.payment.createCredential({ account }))).toBe(account.address)
    expect(context.settlements()).toBe(0)
  })

  test('reports a missing signer only when creating the credential', async () => {
    const context = await fixture(protocol)
    await expect(context.payment.createCredential()).rejects.toThrow(
      'requires a typed-data signer.',
    )
    expect(context.settlements()).toBe(0)
  })

  test('prefers the credential context over a configured account', async () => {
    const configured = privateKeyToAccount(`0x${'02'.repeat(32)}`)
    const fallback = await fixture(protocol, configured)
    expect(fallback.payer(await fallback.payment.createCredential())).toBe(configured.address)
    const context = await fixture(protocol, configured)
    expect(context.payer(await context.payment.createCredential({ account }))).toBe(account.address)
  })
})
