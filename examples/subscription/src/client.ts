import { Credential, Method, Receipt } from 'mppx'
import { Mppx } from 'mppx/client'
import { Methods } from 'mppx/tempo'
import { KeyAuthorization } from 'ox/tempo'
import { createClient, type Address, http } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { Actions } from 'viem/tempo'

import { createDemoChainConfig, type DemoNetwork } from './network.js'

type AccessKeyReference = {
  accessKeyAddress: Address
  keyType: 'p256' | 'secp256k1' | 'webAuthn'
}

type Config = {
  accessKey: AccessKeyReference
  chain: {
    id: number
    name: string
    network: DemoNetwork
    rpcUrl: string
  }
  counter: {
    amount: string
    currency: Address
    periodSeconds: string
    recipient: Address
    subscriptionExpires: string
  }
}

type CounterResponse = {
  count: number
  paidPathUsd: number
  subscriptionId: string | null
}

const account = privateKeyToAccount(generatePrivateKey())

const currencyFormatter = new Intl.NumberFormat('en-US', {
  currency: 'USD',
  style: 'currency',
})

const setup = document.getElementById('setup')!
const ready = document.getElementById('ready')!
const wallet = document.getElementById('wallet')!
const balance = document.getElementById('balance')!
const subscription = document.getElementById('subscription')!
const counter = document.getElementById('counter')!
const total = document.getElementById('total')!
const status = document.getElementById('status')!
const start = document.getElementById('start') as HTMLButtonElement
const stop = document.getElementById('stop') as HTMLButtonElement

let activeSubscriptionId: string | undefined
let running = false
let timer: number | undefined

wallet.textContent = account.address

try {
  const config = await loadConfig()
  const { chain, rpcUrl } = createDemoChainConfig(config.chain)
  const chainClient = createClient({
    account,
    chain,
    pollingInterval: 250,
    transport: http(rpcUrl),
  })
  const mppx = Mppx.create({
    methods: [createSubscriptionMethod(config, chainClient)],
  })

  await Actions.faucet.fundSync(chainClient, { account, timeout: 30_000 })
  await updateBalance(chainClient, config.counter.currency)

  setup.style.display = 'none'
  ready.style.display = 'block'
  setStatus(
    `Wallet ready on ${config.chain.name}. Start the loop to create a subscription and bill one tick per second.`,
  )

  start.addEventListener('click', async () => {
    if (running) return
    running = true
    start.disabled = true
    stop.disabled = false
    await tick(mppx, config, chainClient)
  })

  stop.addEventListener('click', () => {
    running = false
    if (timer !== undefined) window.clearTimeout(timer)
    timer = undefined
    start.disabled = false
    stop.disabled = true
    setStatus('Paused. Resume whenever you want the next billed tick.')
  })
} catch (error) {
  console.error(error)
  setStatus(String(error), true)
  setup.textContent = 'Failed to initialize the demo.'
}

function createSubscriptionMethod(config: Config, chainClient: ReturnType<typeof createClient>) {
  return Method.toClient(Methods.subscription, {
    async createCredential({ challenge }) {
      const chainId = challenge.request.methodDetails?.chainId ?? config.chain.id
      if (challenge.request.currency.toLowerCase() !== config.counter.currency.toLowerCase()) {
        throw new Error('Unexpected subscription currency.')
      }
      if (challenge.request.recipient.toLowerCase() !== config.counter.recipient.toLowerCase()) {
        throw new Error('Unexpected subscription recipient.')
      }

      const periodSeconds = Number(challenge.request.periodSeconds)
      if (!Number.isSafeInteger(periodSeconds) || periodSeconds <= 0) {
        throw new Error('Subscription `periodSeconds` must be a positive safe integer.')
      }

      const expiresAt = new Date(challenge.request.subscriptionExpires).getTime()
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        throw new Error('Subscription has already expired.')
      }

      // The current public `viem/tempo` access-key signer enforces a lifetime
      // token cap. Budget the remaining subscription lifetime up front so the
      // authorize hook can renew one billed second at a time.
      const remainingPeriods = Math.max(
        1,
        Math.ceil((expiresAt - Date.now()) / (periodSeconds * 1_000)),
      )
      const totalLimit = BigInt(challenge.request.amount) * BigInt(remainingPeriods)

      const keyAuthorization = await Actions.accessKey.signAuthorization(chainClient, {
        accessKey: config.accessKey,
        account,
        chainId,
        expiry: Math.floor(expiresAt / 1_000),
        limits: [
          {
            limit: totalLimit,
            token: challenge.request.currency as Address,
          },
        ],
      })

      return Credential.serialize({
        challenge,
        payload: {
          signature: KeyAuthorization.serialize(keyAuthorization as never),
          type: 'keyAuthorization',
        },
        source: `did:pkh:eip155:${chainId}:${account.address}`,
      })
    },
  })
}

async function tick(
  mppx: ReturnType<typeof Mppx.create>,
  config: Config,
  chainClient: ReturnType<typeof createClient>,
) {
  setStatus('Requesting the next billed tick...')

  try {
    const headers = new Headers({
      'X-Subscriber': account.address.toLowerCase(),
    })
    if (activeSubscriptionId) headers.set('Subscription-Id', activeSubscriptionId)

    const response = await mppx.fetch('/api/counter', { headers })
    if (!response.ok) {
      const message = await response.text()
      throw new Error(message || `Counter request failed (${response.status}).`)
    }

    const body = (await response.json()) as CounterResponse
    const receipt = Receipt.fromResponse(response)
    activeSubscriptionId = receipt.subscriptionId ?? body.subscriptionId ?? activeSubscriptionId

    counter.textContent = String(body.count)
    subscription.textContent = activeSubscriptionId ?? 'Pending'
    total.textContent = `${currencyFormatter.format(body.paidPathUsd)} charged so far.`
    await updateBalance(chainClient, config.counter.currency)
    setStatus(`Tick ${body.count} billed successfully.`)
  } catch (error) {
    running = false
    if (timer !== undefined) window.clearTimeout(timer)
    timer = undefined
    start.disabled = false
    stop.disabled = true
    setStatus(String(error), true)
    return
  }

  if (!running) return
  timer = window.setTimeout(() => {
    void tick(mppx, config, chainClient)
  }, 1_000)
}

async function loadConfig(): Promise<Config> {
  const response = await fetch('/api/config')
  if (!response.ok) throw new Error('Failed to load the subscription configuration.')
  return (await response.json()) as Config
}

async function updateBalance(chainClient: ReturnType<typeof createClient>, currency: Address) {
  const value = await Actions.token.getBalance(chainClient, {
    account,
    token: currency,
  })
  balance.textContent = currencyFormatter.format(Number(value) / 1e6)
}

function setStatus(message: string, error = false) {
  status.textContent = message
  status.classList.toggle('error', error)
}
