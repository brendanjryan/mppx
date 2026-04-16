# mppx Examples

Standalone, runnable examples demonstrating the mppx HTTP 402 payment flow.

## Examples

| Example                                       | Description                                          |
| --------------------------------------------- | ---------------------------------------------------- |
| [charge](./charge/)                           | Payment-gated image generation API                   |
| [session/multi-fetch](./session/multi-fetch/) | Multiple paid requests over a single payment channel |
| [session/sse](./session/sse/)                 | Pay-per-token LLM streaming with SSE                 |
| [session/ws](./session/ws/)                   | Pay-per-token LLM streaming with WebSocket           |
| [subscription](./subscription/)               | Recurring 1 pathUSD-per-second subscription demo     |
| [stripe](./stripe/)                           | Stripe SPT charge with automatic client              |

## Running Examples

From the repository root:

```bash
pnpm install
pnpm dev:example
```

This will show a picker to select which example to run.

Selecting `subscription` from the repo root auto-starts a local Tempo container and points
the demo at that RPC.

## Installing via gitpick

You can install any example directly into your project:

```bash
npx gitpick wevm/mppx/examples/charge
```
