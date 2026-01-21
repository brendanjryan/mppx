import { AbiFunction, Address } from 'ox'
import { type Account, type Chain, type Client, parseEventLogs, type Transport } from 'viem'
import { getTransactionReceipt, sendRawTransactionSync, signTransaction } from 'viem/actions'
import { Abis, Transaction } from 'viem/tempo'
import { z } from 'zod/mini'

import * as Intent from '../../Intent.js'
import { InvalidCredentialTypeError, VerificationError } from '../../Intent.js'
import * as Receipt from '../../Receipt.js'

const transfer = AbiFunction.from('function transfer(address to, uint256 amount) returns (bool)')

/**
 * Creates a Tempo `charge` intent.
 *
 * @example
 * ```ts
 * import { Intent } from 'mpay/tempo'
 *
 * const intent = Intent.charge(client)
 *
 * // Create a payment request
 * const request = await intent.request({
 *   amount: '1000000',
 *   asset: '0x20c0000000000000000000000000000000000001',
 *   destination: '0x...',
 *   expires: new Date(Date.now() + 60_000).toISOString(),
 * })
 *
 * // Generate the credential
 * const credential = TODO
 *
 * // Verify credential
 * const result = await intent.verify(credential, request)
 * ```
 *
 * @param client - Viem client to interact with Tempo.
 * @param options - Options.
 * @param options.account - Account to use for fee payer signing.
 * @returns An intent.
 */
export function charge<account extends Account | undefined = undefined>(
  client: Client<Transport, Chain, account>,
  options: charge.Options = {},
) {
  const { account = client.account } = options

  return Intent.define({
    schema: charge.schema,

    async verify(credential, request) {
      const { payload } = credential

      if (new Date(request.expires) < new Date()) throw new VerificationError('Request has expired')

      if (payload.type === 'hash') {
        const receipt = await getTransactionReceipt(client, {
          hash: payload.hash,
        })

        // Verify the receipt contains a Transfer log matching the request
        const logs = parseEventLogs({
          abi: Abis.tip20,
          eventName: 'Transfer',
          logs: receipt.logs,
        })

        const match = logs.find(
          (log) =>
            Address.isEqual(log.address, request.asset) &&
            Address.isEqual(log.args.to, request.destination) &&
            log.args.amount.toString() === request.amount,
        )

        if (!match)
          throw new VerificationError(
            'Transaction must contain a Transfer log matching request parameters',
          )

        return {
          receipt: Receipt.from({
            status: receipt.status === 'success' ? 'success' : 'failed',
            timestamp: new Date().toISOString(),
            reference: receipt.transactionHash,
          }),
        }
      }

      if (payload.type === 'transaction') {
        const serializedTransaction = payload.signature as Transaction.TransactionSerializedTempo
        const transaction = Transaction.deserialize(serializedTransaction)

        const transferCall = transaction.calls?.find((call) => {
          if (!call.to || !Address.isEqual(call.to, request.asset)) return false
          if (!call.data) return false

          try {
            const [to, amount] = AbiFunction.decodeData(transfer, call.data)
            return Address.isEqual(to, request.destination) && amount.toString() === request.amount
          } catch {
            return false
          }
        })

        if (!transferCall)
          throw new VerificationError(
            'Transaction must contain a transfer(to, amount) call matching request parameters',
          )

        const transaction_final = request.feePayer
          ? await signTransaction(client, {
              ...transaction,
              feePayer: account,
            } as never)
          : serializedTransaction

        const receipt = await sendRawTransactionSync(client, {
          serializedTransaction: transaction_final,
        })

        return {
          receipt: Receipt.from({
            status: receipt.status === 'success' ? 'success' : 'failed',
            timestamp: new Date().toISOString(),
            reference: receipt.transactionHash,
          }),
        }
      }

      throw new InvalidCredentialTypeError((payload as { type: string }).type)
    },
  })
}

export namespace charge {
  export type Options = { account?: Account | undefined }

  export const schema = {
    request: z.object({
      amount: z.string(),
      asset: z.templateLiteral([z.literal('0x'), z.string()]),
      destination: z.templateLiteral([z.literal('0x'), z.string()]),
      expires: z.iso.datetime(),
      feePayer: z._default(z.boolean(), false),
    }),

    credentialPayload: z.discriminatedUnion('type', [
      z.object({
        type: z.literal('hash'),
        hash: z.templateLiteral([z.literal('0x'), z.string()]),
      }),
      z.object({
        type: z.literal('transaction'),
        signature: z.templateLiteral([z.literal('0x'), z.string()]),
      }),
    ]),
  }
}
