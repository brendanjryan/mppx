# Subscription

A runnable example that demonstrates the new `tempo/subscription` authorize flow.

It creates a recurring subscription that lets the server charge `1` pathUSD every second,
then shows a visible counter increasing over time as each billed tick is renewed.

From the repository root, `pnpm dev:example subscription` now auto-starts a local Tempo
container with the faucet enabled and points the demo at it.

```bash
pnpm install
pnpm dev:example subscription
```

If you want to run the example directly inside `examples/subscription`, point it at an
already-running Tempo RPC:

```bash
MPPX_EXAMPLE_NETWORK=localnet MPPX_RPC_URL=http://127.0.0.1:8545 pnpm dev
```

For a devnet-style container, keep the same `MPPX_RPC_URL` override and change
`MPPX_EXAMPLE_NETWORK=devnet` so the client and server use the correct chain metadata.
