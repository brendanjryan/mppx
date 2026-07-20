# TAP and Web Bot Auth sandbox

Run a local, end-to-end MPPX attestation exercise:

```bash
pnpm sandbox
```

The sandbox starts a short-lived TCP server on an ephemeral loopback port and
generates fresh Ed25519 keys. It verifies the following flows:

- TAP payment-intent request, `402` challenge, signed MPP retry, and receipt.
- Web Bot Auth identity request, `402` challenge, signed MPP retry, and receipt.
- Web Bot Auth cannot satisfy a TAP payment-intent policy.
- TAP replay and path modification are rejected.
- Web Bot Auth `Signature-Agent` modification is rejected.

It uses the test payment method only; no wallet, external key directory, or
testnet funds are required. The command selects MPPX's `src` export condition,
so it exercises the current worktree implementation rather than an existing
`dist` build.
