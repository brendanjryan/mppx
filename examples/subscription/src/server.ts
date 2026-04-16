import { Mppx, Store, tempo } from 'mppx/server'
import { Subscription } from 'mppx/tempo'
import { KeyAuthorization } from 'ox/tempo'
import { createClient, type Address, http } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { prepareTransactionRequest, sendRawTransactionSync, signTransaction } from 'viem/actions'
import { Account as TempoAccount, Actions } from 'viem/tempo'

import { createDemoChainConfig } from './network.js'

const currency = '0x20c0000000000000000000000000000000000000' as const // pathUSD
const periodSeconds = '1'
const resourceId = 'counter'
const secretKey = 'subscription-example-secret-key'
const subscriptionExpires = new Date(Date.now() + 10 * 60 * 1_000).toISOString()

const recipient = privateKeyToAccount(generatePrivateKey())
const serverAccessKeyPrivateKey = generatePrivateKey()
const serverAccessKey = TempoAccount.fromSecp256k1(serverAccessKeyPrivateKey)
const { chain, network, rpcUrl } = createDemoChainConfig({
  network: process.env.MPPX_EXAMPLE_NETWORK,
  rpcUrl: process.env.MPPX_RPC_URL,
})

const chainClient = createClient({
  chain,
  pollingInterval: 250,
  transport: http(rpcUrl),
})

const rawStore = Store.memory()
const subscriptionStore = Subscription.fromStore(rawStore)

type SignedKeyAuthorization = ReturnType<typeof KeyAuthorization.deserialize> & {
  signature: NonNullable<ReturnType<typeof KeyAuthorization.deserialize>['signature']>
}
type StoredSubscription = NonNullable<Awaited<ReturnType<typeof subscriptionStore.get>>>

const mppx = Mppx.create({
  methods: [
    tempo.subscription({
      amount: '1',
      chainId: chain.id,
      currency,
      description: 'Counter tick',
      getClient: () => chainClient,
      async getIdentity({ input }) {
        const id = getSubscriberId(input)
        return id ? { id } : null
      },
      async getResource() {
        return { id: resourceId }
      },
      periodSeconds,
      recipient: recipient.address,
      store: rawStore,
      subscriptionExpires,
      async activate({ credential, input, request, source }) {
        if (!source) throw new Error('Missing subscription source.')

        const subscriberId = getSubscriberId(input)
        if (!subscriberId || subscriberId !== source.address.toLowerCase()) {
          throw new Error('Subscription source does not match the subscriber header.')
        }

        const accessKey = createSubscriptionAccessKey(source.address)
        const keyAuthorization = KeyAuthorization.deserialize(
          credential.payload.signature,
        ) as SignedKeyAuthorization
        if (keyAuthorization.address.toLowerCase() !== accessKey.accessKeyAddress.toLowerCase()) {
          throw new Error('Subscription was signed for a different access key.')
        }

        const timestamp = new Date().toISOString()
        const transfer = await chargeTick({
          amount: BigInt(request.amount),
          keyAuthorization,
          subscriber: source.address,
        })

        const subscriptionId = crypto.randomUUID()
        return {
          receipt: Subscription.createSubscriptionReceipt({
            reference: transfer.transactionHash,
            subscriptionId,
            timestamp,
          }),
          subscription: {
            amount: request.amount,
            billingAnchor: timestamp,
            chainId: request.methodDetails?.chainId,
            currency: request.currency,
            identityId: subscriberId,
            lastChargedPeriod: 0,
            periodSeconds: request.periodSeconds,
            recipient: request.recipient,
            reference: transfer.transactionHash,
            resourceId,
            subscriptionExpires: request.subscriptionExpires,
            subscriptionId,
            timestamp,
          },
        }
      },
      async renew({ identity, request, subscription }) {
        const timestamp = new Date().toISOString()
        const transfer = await chargeTick({
          amount: BigInt(request.amount),
          subscriber: identity.id as Address,
        })

        return {
          receipt: Subscription.createSubscriptionReceipt({
            reference: transfer.transactionHash,
            subscriptionId: subscription.subscriptionId,
            timestamp,
          }),
          subscription: {
            ...subscription,
            lastChargedPeriod: subscription.lastChargedPeriod + 1,
            reference: transfer.transactionHash,
            timestamp,
          },
        }
      },
    }),
  ],
  secretKey,
})

export async function handler(request: Request): Promise<Response | null> {
  const url = new URL(request.url)

  if (url.pathname === '/api/health') return Response.json({ status: 'ok' })

  if (url.pathname === '/api/config') {
    return Response.json({
      accessKey: {
        accessKeyAddress: serverAccessKey.address,
        keyType: serverAccessKey.keyType,
      },
      chain: {
        id: chain.id,
        name: chain.name,
        network,
        rpcUrl,
      },
      counter: {
        amount: '1',
        currency,
        periodSeconds,
        recipient: recipient.address,
        subscriptionExpires,
      },
    })
  }

  if (url.pathname === '/api/counter') {
    const result = await mppx['tempo/subscription']({})(request)
    if (result.status === 402) return result.challenge

    const subscriberId = getSubscriberId(request)
    const subscriptionId = request.headers.get('Subscription-Id')?.trim() || undefined
    const subscription = subscriberId ? await getSubscription(subscriberId, subscriptionId) : null
    const count = subscription ? subscription.lastChargedPeriod + 1 : 0

    return result.withReceipt(
      Response.json({
        count,
        paidPathUsd: count,
        subscriptionId: subscription?.subscriptionId ?? null,
      }),
    )
  }

  return null
}

async function chargeTick(parameters: {
  amount: bigint
  keyAuthorization?: SignedKeyAuthorization | undefined
  subscriber: Address
}) {
  const account = createSubscriptionAccessKey(parameters.subscriber)
  const call = Actions.token.transfer.call({
    amount: parameters.amount,
    to: recipient.address,
    token: currency,
  })
  const transaction = await prepareTransactionRequest(chainClient, {
    account,
    calls: [call],
    feePayer: true,
    feeToken: currency,
    ...(parameters.keyAuthorization ? { keyAuthorization: parameters.keyAuthorization } : {}),
  } as never)
  const serializedTransaction = await signTransaction(chainClient, {
    ...transaction,
    account,
    feePayer: serverAccessKey,
  } as never)
  return sendRawTransactionSync(chainClient, {
    serializedTransaction,
  })
}

function createSubscriptionAccessKey(subscriber: Address) {
  return TempoAccount.fromSecp256k1(serverAccessKeyPrivateKey, {
    access: subscriber,
  })
}

async function getSubscription(subscriberId: string, subscriptionId?: string | undefined) {
  if (subscriptionId) {
    const record = await subscriptionStore.get(subscriptionId)
    if (record && isActive(record)) return record
  }

  const records = await subscriptionStore.listByIdentityResource(subscriberId, resourceId)
  const active = records.filter(isActive)
  if (active.length === 0) return null
  return (
    active.sort(
      (left: StoredSubscription, right: StoredSubscription) =>
        right.lastChargedPeriod - left.lastChargedPeriod,
    )[0] ?? null
  )
}

function getSubscriberId(request: Request): string | null {
  const subscriber = request.headers.get('X-Subscriber')?.trim().toLowerCase()
  return subscriber || null
}

function isActive(record: {
  canceledAt?: string
  revokedAt?: string
  subscriptionExpires: string
}) {
  if (record.canceledAt || record.revokedAt) return false
  return new Date(record.subscriptionExpires).getTime() > Date.now()
}

// The server reuses the access-key root signer as the fee sponsor so the
// subscriber only authorizes token transfers, not recurring gas spend.
await Actions.faucet.fundSync(chainClient, { account: serverAccessKey, timeout: 30_000 })
