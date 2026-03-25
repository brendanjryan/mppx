import { createStore } from 'mipd'
import type { EIP1193Provider } from 'mipd'
import { createClient, custom, encodeFunctionData, parseAbi } from 'viem'
import { sendTransactionSync } from 'viem/actions'
import { tempo as tempoMainnet, tempoLocalnet, tempoModerato } from 'viem/chains'

const request = mppx.challenge.request as Record<string, any>

const store = createStore()
const walletsEl = document.getElementById('wallets')!
const connectedEl = document.getElementById('connected')!
const accountDisplay = document.getElementById('account-display')!
const payBtn = document.getElementById('pay-btn') as HTMLButtonElement
let activeProvider: EIP1193Provider | null = null
let activeAccount: string | null = null

function renderWallets() {
  if (activeAccount) return
  const providers = store.getProviders()
  if (!providers.length) {
    walletsEl.innerHTML = '<p>No wallets detected.</p>'
    return
  }
  walletsEl.innerHTML = ''
  for (const p of providers) {
    const btn = document.createElement('button')
    btn.textContent = 'Connect ' + p.info.name
    btn.onclick = () => connect(p.provider)
    walletsEl.appendChild(btn)
  }
}

function showConnected(account: string) {
  activeAccount = account
  accountDisplay.textContent = account.slice(0, 6) + '...' + account.slice(-4)
  walletsEl.hidden = true
  connectedEl.hidden = false
}

function disconnect() {
  activeProvider = null
  activeAccount = null
  walletsEl.hidden = false
  connectedEl.hidden = true
  renderWallets()
}

document.getElementById('disconnect-btn')!.onclick = disconnect
payBtn.onclick = () => pay()

// Set pay button label from challenge amount
const rawAmount = request.amount as string
const decimals = (request.decimals as number) || 6
const whole = rawAmount.slice(0, -decimals) || '0'
const frac = rawAmount.slice(-decimals).padStart(decimals, '0').replace(/0+$/, '')
const formatted = frac ? whole + '.' + frac : whole
payBtn.textContent = 'Pay $' + formatted

store.subscribe(renderWallets)
renderWallets()

async function connect(provider: EIP1193Provider) {
  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[]
  const account = accounts[0]
  if (!account) throw new Error('No account selected')
  activeProvider = provider
  showConnected(account)
}

async function pay() {
  if (!activeProvider || !activeAccount) return
  payBtn.disabled = true

  try {
    const chainId = (request.methodDetails?.chainId as number) || 42432

    const chain = (() => {
      if (chainId === tempoMainnet.id) return tempoMainnet
      if (chainId === tempoModerato.id) return tempoModerato
      if (chainId === tempoLocalnet.id) return tempoLocalnet
      throw new Error('Unsupported chain: ' + chainId)
    })()
    const hexChainId = '0x' + chainId.toString(16)
    const currentChain = (await activeProvider.request({ method: 'eth_chainId' })) as string
    if (parseInt(currentChain, 16) !== chainId) {
      try {
        await activeProvider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: hexChainId }],
        })
      } catch (e: any) {
        if (e.code === 4902) {
          await activeProvider.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: hexChainId,
                chainName: chain.name,
                nativeCurrency: { name: 'USD', symbol: 'USD', decimals: 18 },
                rpcUrls: [chain.rpcUrls.default.http[0]],
              },
            ],
          })
        } else {
          throw e
        }
      }
    }

    const client = createClient({
      account: activeAccount as `0x${string}`,
      chain,
      transport: custom(activeProvider),
    })

    const receipt = await sendTransactionSync(client, {
      to: request.currency as `0x${string}`,
      data: encodeFunctionData({
        abi: parseAbi(['function transfer(address to, uint256 amount)']),
        args: [request.recipient as `0x${string}`, BigInt(request.amount as string)],
      }),
    })

    dispatchEvent(
      new CustomEvent('mppx:complete', {
        detail: mppx.serializeCredential(
          { hash: receipt.transactionHash, type: 'hash' },
          'did:pkh:eip155:' + chainId + ':' + activeAccount,
        ),
      }),
    )
  } catch {
    payBtn.disabled = false
  }
}
