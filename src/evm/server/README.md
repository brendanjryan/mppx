# EVM validation and settlement

An EVM server supports the same `validateCredential` and `broadcastCredential` lifecycle as
Tempo. For a native Payment credential, use the server that issued the challenge:

```ts
const options = { realm: 'api.example.com', request: { amount: '0.25' }, scope: 'job:123' }
const validation = await server.validateCredential(credential, options)
// Atomically claim the application operation using validation.source and the job identity.
const receipt = await server.broadcastCredential(credential, options)
// Persist the completed operation and receipt.reference.
```

Validation checks payment terms, expiry, signature, and payer identity. With the default
facilitator-backed settler it also calls the facilitator's verification endpoint, without
calling settlement. A custom `settle` implementation remains responsible for chain-state
checks and replay protection. Validation is not a reservation or a settlement receipt.

Broadcast revalidates, then settles. Existing route handlers and `verifyCredential` still
perform the complete validate-and-settle flow. The application owns durable claims,
idempotency, and reconciliation if settlement succeeds but persisting its result fails.

For x402, first normalize the transport-native payload with the configured EVM method's
transport. The route challenge must be generated from the server's authoritative route
configuration, including its scope, metadata, and expiration:

```ts
const transport = method.transport!
const pending = transport.getCredential(paidRequest)
if (!pending) throw new Error('Missing payment credential')
const credential = await transport.bindCredential!({
  challenge: routeChallenge,
  credential: pending,
  input: paidRequest,
})
const capturedRequest = await transport.captureRequest!(paidRequest)
const options = { capturedRequest, request: { amount: '0.25' }, scope: 'job:123' }
const validation = await server.validateCredential(credential, options)
// Claim the operation before calling server.broadcastCredential(credential, options).
```

Use the bound credential object directly so its x402 provenance is retained. Do not treat
an unbound `PAYMENT-SIGNATURE` value as a native Payment credential or bypass transport
resource/body binding. Existing x402 route handlers still perform normalization automatically.
