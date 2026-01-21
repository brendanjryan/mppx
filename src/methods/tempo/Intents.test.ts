import { prepareTransactionRequest, signTransaction } from 'viem/actions'
import { Actions } from 'viem/tempo'
import { describe, expect, test } from 'vitest'
import { accounts, asset, chain, client } from '~test/tempo/viem.js'
import { VerificationError } from '../../Intent.js'
import * as Tempo from './Intent.js'

const consumer = accounts[1]
const destination = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const
const amount = '1000000'

describe('charge', () => {
  const intent = Tempo.charge(client)

  describe('request', () => {
    test('default', async () => {
      const request = await intent.request({
        amount,
        asset,
        destination,
        expires: futureExpiry(),
      })

      expect(request.amount).toBe(amount)
      expect(request.asset).toBe(asset)
      expect(request.destination).toBe(destination)
      expect(request.feePayer).toBe(false)
    })

    test('with feePayer', async () => {
      const request = await intent.request({
        amount,
        asset,
        destination,
        expires: futureExpiry(),
        feePayer: true,
      })

      expect(request.feePayer).toBe(true)
    })
  })

  describe('verify', () => {
    test('rejects expired request', async () => {
      const request = await intent.request({
        amount,
        asset,
        destination,
        expires: pastExpiry(),
      })

      await expect(
        intent.verify(
          {
            id: 'test-id',
            payload: { type: 'hash', hash: '0x1234' },
          },
          request,
        ),
      ).rejects.toThrow(VerificationError)
    })

    describe('type: hash', () => {
      test('default', async () => {
        const { receipt } = await Actions.token.transferSync(client, {
          account: consumer,
          chain,
          token: asset,
          to: destination,
          amount: BigInt(amount),
        })
        const hash = receipt.transactionHash

        const request = await intent.request({
          amount,
          asset,
          destination,
          expires: futureExpiry(),
        })

        const result = await intent.verify(
          {
            id: 'test-id',
            payload: { type: 'hash', hash },
          },
          request,
        )

        const { reference, timestamp, ...rest } = result.receipt
        expect(reference).toBe(hash)
        expect(timestamp).toBeDefined()
        expect(rest).toMatchInlineSnapshot(`
          {
            "status": "success",
          }
        `)
      })

      test('rejects hash without matching transfer log', async () => {
        const { receipt } = await Actions.token.transferSync(client, {
          account: consumer,
          chain,
          token: asset,
          to: '0x0000000000000000000000000000000000000001',
          amount: BigInt(amount),
        })
        const hash = receipt.transactionHash

        const request = await intent.request({
          amount,
          asset,
          destination,
          expires: futureExpiry(),
        })

        await expect(
          intent.verify(
            {
              id: 'test-id',
              payload: { type: 'hash' as const, hash },
            },
            request,
          ),
        ).rejects.toThrow(VerificationError)
      })
    })

    describe('type: transaction', () => {
      test('verifies transaction with valid transfer call', async () => {
        const request = await intent.request({
          amount,
          asset,
          destination,
          expires: futureExpiry(),
        })

        const prepared = await prepareTransactionRequest(client, {
          account: consumer,
          chain,
          calls: [
            Actions.token.transfer.call({ token: asset, to: destination, amount: BigInt(amount) }),
          ],
        })
        const serializedTransaction = await signTransaction(client, prepared)

        const result = await intent.verify(
          {
            id: 'test-id',
            payload: { type: 'transaction', signature: serializedTransaction },
          },
          request,
        )

        const { reference, timestamp, ...rest } = result.receipt
        expect(reference).toMatch(/^0x[a-fA-F0-9]{64}$/)
        expect(timestamp).toBeDefined()
        expect(rest).toMatchInlineSnapshot(`
          {
            "status": "success",
          }
        `)
      })

      test('rejects transaction without matching transfer call', async () => {
        const request = await intent.request({
          amount,
          asset,
          destination,
          expires: futureExpiry(),
        })

        const serializedTransaction = await signTransaction(client, {
          account: consumer,
          chain,
          calls: [
            Actions.token.transfer.call({
              token: asset,
              to: '0x0000000000000000000000000000000000000001',
              amount: BigInt(amount),
            }),
          ],
        })

        await expect(
          intent.verify(
            {
              id: 'test-id',
              payload: { type: 'transaction', signature: serializedTransaction },
            },
            request,
          ),
        ).rejects.toThrow(VerificationError)
      })

      test('rejects transaction with wrong amount', async () => {
        const request = await intent.request({
          amount,
          asset,
          destination,
          expires: futureExpiry(),
        })

        const serializedTransaction = await signTransaction(client, {
          account: consumer,
          chain,
          calls: [Actions.token.transfer.call({ token: asset, to: destination, amount: 999999n })],
        })

        await expect(
          intent.verify(
            {
              id: 'test-id',
              payload: { type: 'transaction', signature: serializedTransaction },
            },
            request,
          ),
        ).rejects.toThrow(VerificationError)
      })

      test('rejects transaction targeting wrong asset', async () => {
        const request = await intent.request({
          amount,
          asset,
          destination,
          expires: futureExpiry(),
        })

        const wrongAsset = '0x20c0000000000000000000000000000000000002' as const
        const serializedTransaction = await signTransaction(client, {
          account: consumer,
          chain,
          calls: [
            Actions.token.transfer.call({
              token: wrongAsset,
              to: destination,
              amount: BigInt(amount),
            }),
          ],
        })

        await expect(
          intent.verify(
            {
              id: 'test-id',
              payload: { type: 'transaction', signature: serializedTransaction },
            },
            request,
          ),
        ).rejects.toThrow(VerificationError)
      })

      test('utilizes fee payer when requested', async () => {
        const request = await intent.request({
          amount,
          asset,
          destination,
          expires: futureExpiry(),
          feePayer: true,
        })

        const prepared = await prepareTransactionRequest(client, {
          account: consumer,
          chain,
          calls: [
            Actions.token.transfer.call({ token: asset, to: destination, amount: BigInt(amount) }),
          ],
          feePayer: request.feePayer,
        } as never)
        const serializedTransaction = await signTransaction(client, prepared)

        const result = await intent.verify(
          {
            id: 'test-id',
            payload: { type: 'transaction', signature: serializedTransaction },
          },
          request,
        )

        const { reference, timestamp, ...rest } = result.receipt
        expect(reference).toMatch(/^0x[a-fA-F0-9]{64}$/)
        expect(timestamp).toBeDefined()
        expect(rest).toMatchInlineSnapshot(`
          {
            "status": "success",
          }
        `)
      })
    })
  })
})

function futureExpiry() {
  return new Date(Date.now() + 60_000).toISOString()
}

function pastExpiry() {
  return new Date(Date.now() - 60_000).toISOString()
}
