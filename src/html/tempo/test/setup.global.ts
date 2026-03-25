import assert from 'node:assert'

import { RpcTransport } from 'ox'
import { Server } from 'prool'
import * as TestContainers from 'prool/testcontainers'
import { tempoLocalnet } from 'viem/chains'

export default async function () {
  if (process.env.TEMPO_RPC_URL) return

  const tag = await (async () => {
    if (!process.env.VITE_TEMPO_TAG?.startsWith('http')) return process.env.VITE_TEMPO_TAG
    const transport = RpcTransport.fromHttp(process.env.VITE_TEMPO_TAG)
    const result = (await transport.request({
      method: 'web3_clientVersion',
    })) as string
    const sha = result.match(/tempo\/v[\d.]+-([a-f0-9]+)\//)?.[1]
    return `sha-${sha}`
  })()

  const server = Server.create({
    instance: TestContainers.Instance.tempo({
      blockTime: '200ms',
      mnemonic: 'test test test test test test test test test test test junk',
      image: `ghcr.io/tempoxyz/tempo:${tag ?? 'latest'}`,
    }),
  })

  await server.start()

  const address = server.address()
  assert(address?.port)
  const rpcUrl = `http://localhost:${address.port}/1`
  await fetch(`${rpcUrl}/start`)

  process.env.TEMPO_CHAIN_ID = String(tempoLocalnet.id)
  process.env.TEMPO_RPC_URL = rpcUrl

  return () => server.stop()
}
