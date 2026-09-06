# Deferred EVM signing

## Choose the signer after preparation

`evm.charge()` accepts an optional account. `preparePayment` selects and snapshots an offer
without signing it. Supply the account to `createCredential` when ready to pay:

```ts
import { Mppx, evm } from 'mppx/client'
import type { Account } from 'viem'

async function prepare(response: Response, account: Account) {
  const client = Mppx.create({
    methods: [evm.charge({ currencies: [evm.assets.base.USDC], networks: [8453] })],
    polyfill: false,
  })
  const payment = await client.preparePayment(response)
  // Inspect payment.challenge and enforce the application's quote/budget policy here.
  return payment.createCredential({ account })
}
```

This works for native EVM Payment-auth and x402 exact offers. A credential-context account
takes precedence over the configured account. If neither is a typed-data signer, credential
creation rejects with a descriptive error; preparation remains available.
