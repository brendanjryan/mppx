import { defineChain } from 'viem'
import { tempoDevnet, tempoLocalnet, tempoModerato } from 'viem/chains'

export type DemoNetwork = 'devnet' | 'localnet' | 'testnet'

const baseChains = {
  devnet: tempoDevnet,
  localnet: tempoLocalnet,
  testnet: tempoModerato,
} as const

const defaultRpcUrls: Record<DemoNetwork, string> = {
  devnet: tempoDevnet.rpcUrls.default.http[0]!,
  localnet: 'http://127.0.0.1:8545',
  testnet: tempoModerato.rpcUrls.default.http[0]!,
}

export type DemoChainConfig = {
  chain: ReturnType<typeof defineChain>
  network: DemoNetwork
  rpcUrl: string
}

export function createDemoChainConfig(parameters: {
  network?: DemoNetwork | string | undefined
  rpcUrl?: string | undefined
}): DemoChainConfig {
  const network = resolveDemoNetwork(parameters)
  const rpcUrl = parameters.rpcUrl?.trim() || defaultRpcUrls[network]
  const baseChain = baseChains[network]

  return {
    chain: defineChain({
      ...baseChain,
      rpcUrls: {
        ...baseChain.rpcUrls,
        default: {
          ...baseChain.rpcUrls.default,
          http: [rpcUrl],
        },
      },
    }),
    network,
    rpcUrl,
  }
}

function resolveDemoNetwork(parameters: {
  network?: DemoNetwork | string | undefined
  rpcUrl?: string | undefined
}): DemoNetwork {
  if (parameters.network === 'devnet') return 'devnet'
  if (parameters.network === 'localnet') return 'localnet'
  if (parameters.network === 'testnet') return 'testnet'
  if (parameters.rpcUrl && isLoopbackRpcUrl(parameters.rpcUrl)) return 'localnet'
  return 'testnet'
}

function isLoopbackRpcUrl(rpcUrl: string): boolean {
  try {
    const url = new URL(rpcUrl)
    return ['127.0.0.1', '::1', 'localhost'].includes(url.hostname)
  } catch {
    return false
  }
}
