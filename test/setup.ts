import { beforeEach } from 'vitest'
import { nodeEnv } from './config.js'
import { rpcUrl } from './prool.js'
import { accounts, asset, fundAccount } from './tempo/viem.js'

beforeEach(async () => {
  await fundAccount({ address: accounts[1].address, token: asset })
})

afterAll(async () => {
  if (nodeEnv !== 'localnet') return
  await fetch(`${rpcUrl}/stop`)
})
