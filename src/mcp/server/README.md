# MCP payment composition

`Mppx.create({ transport: Transport.mcpSdk(), ... })` supports the same instance `compose`
entry tuples as HTTP. Each entry can reference a registered method, handler, or method key.

```ts
import { Mppx, tempo, Transport } from 'mppx/server'
import { mach } from 'mppx/tempo'
import { usdce } from 'viem/tokens'

const server = Mppx.create({
  methods: [tempo.charge({ recipient, decimals: 6 })],
  realm: 'api.example.com',
  secretKey,
  transport: Transport.mcpSdk(),
})
const charge = server.compose(
  ['tempo/charge', { amount: '1', currency: mach(4217).address }],
  ['tempo/charge', { amount: '1', currency: usdce.addresses[4217] }],
)

// Inside an MCP SDK tool handler:
const payment = await charge(extra)
if (payment.status === 402) throw payment.challenge
return payment.withReceipt({ content: [{ type: 'text', text: 'Result' }] })
```

Without a credential, the MCP error contains all offers in configured order. With a
credential, composition dispatches to one matching offer, including when multiple offers
share a method and intent. Verification failures retain their error code and retry
challenge rather than attempting another payment. Receipts retain existing tool metadata.

Use `Transport.mcp()` for raw JSON-RPC inputs and outputs; composition preserves the request
ID and returns an MCP error response instead of an SDK `McpError`.

All entries must use the configured MCP transport. HTTP-only `canOffer` and `selectOffers`
hooks do not apply to MCP composition; select the application's offered entries before
calling `compose`. Static `Mppx.compose(...)` remains an HTTP handler combinator.
