import { tempoModerato } from 'viem/chains'
import { Addresses } from 'viem/tempo'
import { defineConfig } from 'vite'

import * as Methods from '../../tempo/Methods.js'
import { build, dev } from '../vite.js'

export default defineConfig({
  plugins: [
    dev({
      method: Methods.charge,
      request: {
        amount: '1',
        currency: Addresses.pathUsd,
        decimals: 6,
        description: 'Test payment',
        recipient: '0x0000000000000000000000000000000000000002',
        chainId: Number(process.env.TEMPO_CHAIN_ID ?? tempoModerato.id),
      },
    }),
    build('charge'),
  ],
})
