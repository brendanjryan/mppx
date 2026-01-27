import { prepareTransactionRequest, signTransaction } from 'viem/actions'
import { Actions } from 'viem/tempo'
import { describe, expect, test } from 'vitest'
import * as Http from '~test/Http.js'
import { rpcUrl } from '~test/tempo/prool.js'
import { accounts, asset, chain, client } from '~test/tempo/viem.js'
import * as Challenge from '../../Challenge.js'
import * as Credential from '../../Credential.js'
import * as Receipt from '../../Receipt.js'
import * as PaymentHandler from './PaymentHandler.js'
import type { Hex } from 'ox'

const realm = 'api.example.com'
const secretKey = 'test-secret-key'

const handler = PaymentHandler.tempo({
  chainId: chain.id,
  realm,
  rpcUrl,
  secretKey,
})

describe('tempo', () => {
  describe('intent: charge; type: hash', () => {
    test('default', async () => {
      const request = {
        amount: '1000000',
        currency: asset,
        expires: new Date(Date.now() + 60_000).toISOString(),
        recipient: accounts[0].address,
        feePayer: true,
      } as const

      const server = await Http.createServer(async (req, res) => {
        await handler.charge({ request })(req, res)
        if (!res.headersSent) res.end('OK')
      })

      const response = await fetch(server.url)
      expect(response.status).toBe(402)

      const challenge = Challenge.fromResponse(response, {
        handler,
      })

      const { receipt } = await Actions.token.transferSync(client, {
        account: accounts[1],
        amount: BigInt(challenge.request.amount),
        to: challenge.request.recipient as Hex.Hex,
        token: challenge.request.currency as Hex.Hex,
      })
      const hash = receipt.transactionHash

      const credential = Credential.from({
        challenge,
        payload: { hash, type: 'hash' as const },
      })

      {
        const response = await fetch(server.url, {
          headers: { Authorization: Credential.serialize(credential) },
        })
        expect(response.status).toBe(200)

        const receipt = Receipt.fromResponse(response)
        expect({
          ...receipt,
          reference: '[reference]',
          timestamp: '[timestamp]',
        }).toMatchInlineSnapshot(`
            {
              "method": "tempo",
              "reference": "[reference]",
              "status": "success",
              "timestamp": "[timestamp]",
            }
          `)
      }

      server.close()
    })

    test('behavior: rejects hash with non-matching Transfer log', async () => {
      const wrongRecipient = accounts[2].address

      const request = {
        amount: '1000000',
        currency: asset,
        expires: new Date(Date.now() + 60_000).toISOString(),
        recipient: accounts[0].address,
      } as const

      const server = await Http.createServer(async (req, res) => {
        await handler.charge({ request })(req, res)
        if (!res.headersSent) res.end('OK')
      })

      const response = await fetch(server.url)
      expect(response.status).toBe(402)

      const challenge = Challenge.fromResponse(response, { handler })

      const { receipt } = await Actions.token.transferSync(client, {
        account: accounts[1],
        amount: BigInt(challenge.request.amount),
        to: wrongRecipient,
        token: challenge.request.currency as Hex.Hex,
      })

      const credential = Credential.from({
        challenge,
        payload: { hash: receipt.transactionHash, type: 'hash' as const },
      })

      {
        const response = await fetch(server.url, {
          headers: { Authorization: Credential.serialize(credential) },
        })
        expect(response.status).toBe(402)
        const body = (await response.json()) as { detail: string }
        expect(body.detail).toBe(
          'Payment verification failed: Transaction must contain a Transfer log matching request parameters.',
        )
      }

      server.close()
    })

    test('behavior: rejects expired request', async () => {
      const request = {
        amount: '1000000',
        currency: asset,
        expires: new Date(Date.now() - 1000).toISOString(),
        recipient: accounts[0].address,
      } as const

      const server = await Http.createServer(async (req, res) => {
        await handler.charge({ request })(req, res)
        if (!res.headersSent) res.end('OK')
      })

      const response = await fetch(server.url)
      expect(response.status).toBe(402)

      const challenge = Challenge.fromResponse(response, { handler })

      const { receipt } = await Actions.token.transferSync(client, {
        account: accounts[1],
        amount: BigInt(challenge.request.amount),
        to: challenge.request.recipient as Hex.Hex,
        token: challenge.request.currency as Hex.Hex,
      })

      const credential = Credential.from({
        challenge,
        payload: { hash: receipt.transactionHash, type: 'hash' as const },
      })

      {
        const response = await fetch(server.url, {
          headers: { Authorization: Credential.serialize(credential) },
        })
        expect(response.status).toBe(402)
        const body = (await response.json()) as { detail: string }
        expect(body.detail).toBe('Payment verification failed: Request has expired.')
      }

      server.close()
    })
  })

  describe('intent: charge; type: transaction', () => {
    test('default', async () => {
      const request = {
        amount: '1000000',
        currency: asset,
        expires: new Date(Date.now() + 60_000).toISOString(),
        recipient: accounts[0].address,
      } as const

      const server = await Http.createServer(async (req, res) => {
        await handler.charge({ request })(req, res)
        if (!res.headersSent) res.end('OK')
      })

      const response = await fetch(server.url)
      expect(response.status).toBe(402)

      const challenge = Challenge.fromResponse(response, { handler })

      const prepared = await prepareTransactionRequest(client, {
        account: accounts[1],
        calls: [
          Actions.token.transfer.call({
            to: challenge.request.recipient as Hex.Hex,
            token: challenge.request.currency as Hex.Hex,
            amount: BigInt(challenge.request.amount),
          }),
        ],
      })
      const serializedTransaction = await signTransaction(client, prepared)

      const credential = Credential.from({
        challenge,
        payload: { signature: serializedTransaction, type: 'transaction' as const },
      })

      {
        const response = await fetch(server.url, {
          headers: { Authorization: Credential.serialize(credential) },
        })
        expect(response.status).toBe(200)
        const receipt = Receipt.fromResponse(response)
        expect({
          ...receipt,
          reference: '[reference]',
          timestamp: '[timestamp]',
        }).toMatchInlineSnapshot(`
            {
              "method": "tempo",
              "reference": "[reference]",
              "status": "success",
              "timestamp": "[timestamp]",
            }
          `)
      }

      server.close()
    })

    test('behavior: fee payer', async () => {
      const handler = PaymentHandler.tempo({
        chainId: chain.id,
        feePayer: accounts[0],
        realm,
        rpcUrl,
        secretKey,
      })

      const request = {
        amount: '1000000',
        currency: asset,
        expires: new Date(Date.now() + 60_000).toISOString(),
        feePayer: true,
        recipient: accounts[0].address,
      } as const

      const server = await Http.createServer(async (req, res) => {
        await handler.charge({ request })(req, res)
        if (!res.headersSent) res.end('OK')
      })

      const response = await fetch(server.url)
      expect(response.status).toBe(402)

      const challenge = Challenge.fromResponse(response, { handler })
      if (challenge.intent !== 'charge') throw new Error()

      const prepared = await prepareTransactionRequest(client, {
        account: accounts[1],
        calls: [
          Actions.token.transfer.call({
            to: challenge.request.recipient as Hex.Hex,
            token: challenge.request.currency as Hex.Hex,
            amount: BigInt(challenge.request.amount),
          }),
        ],
        feePayer: challenge.request.methodDetails?.feePayer as true,
      })
      const serializedTransaction = await signTransaction(client, prepared)

      const credential = Credential.from({
        challenge,
        payload: { signature: serializedTransaction, type: 'transaction' as const },
      })

      {
        const response = await fetch(server.url, {
          headers: { Authorization: Credential.serialize(credential) },
        })
        expect(response.status).toBe(200)

        const receipt = Receipt.fromResponse(response)
        expect({
          ...receipt,
          reference: '[reference]',
          timestamp: '[timestamp]',
        }).toMatchInlineSnapshot(`
            {
              "method": "tempo",
              "reference": "[reference]",
              "status": "success",
              "timestamp": "[timestamp]",
            }
          `)
      }

      server.close()
    })

    test('behavior: rejects transaction with non-matching transfer call', async () => {
      const wrongRecipient = accounts[2].address

      const request = {
        amount: '1000000',
        currency: asset,
        expires: new Date(Date.now() + 60_000).toISOString(),
        recipient: accounts[0].address,
      } as const

      const server = await Http.createServer(async (req, res) => {
        await handler.charge({ request })(req, res)
        if (!res.headersSent) res.end('OK')
      })

      const response = await fetch(server.url)
      expect(response.status).toBe(402)

      const challenge = Challenge.fromResponse(response, { handler })

      const serializedTransaction = await signTransaction(client, {
        account: accounts[1],
        calls: [
          Actions.token.transfer.call({
            to: wrongRecipient,
            token: challenge.request.currency as Hex.Hex,
            amount: BigInt(challenge.request.amount),
          }),
        ],
      })

      const credential = Credential.from({
        challenge,
        payload: { signature: serializedTransaction, type: 'transaction' as const },
      })

      {
        const response = await fetch(server.url, {
          headers: { Authorization: Credential.serialize(credential) },
        })
        expect(response.status).toBe(402)
        const body = (await response.json()) as { detail: string }
        expect(body.detail).toBe(
          'Payment verification failed: Transaction must contain a transfer(to, amount) call matching request parameters.',
        )
      }

      server.close()
    })
  })

  describe('intent: unknown', () => {
    test('behavior: returns 402 for invalid payload schema', async () => {
      const request = {
        amount: '1000000',
        currency: asset,
        expires: new Date(Date.now() + 60_000).toISOString(),
        recipient: accounts[0].address,
      } as const

      const server = await Http.createServer(async (req, res) => {
        await handler.charge({ request })(req, res)
        if (!res.headersSent) res.end('OK')
      })

      const response = await fetch(server.url)
      expect(response.status).toBe(402)

      const challenge = Challenge.fromResponse(response, { handler })

      const credential = Credential.from({
        challenge,
        payload: { type: 'unknown' as never },
      })

      {
        const response = await fetch(server.url, {
          headers: { Authorization: Credential.serialize(credential) },
        })
        expect(response.status).toBe(402)
      }

      server.close()
    })
  })
})
