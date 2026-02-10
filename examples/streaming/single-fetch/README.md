# Stream: Single Fetch

A single paid request over a payment channel, then close and settle. Demonstrates a scraping use case where the client opens a channel, fetches one page, closes the channel, and the server settles on-chain.

## Setup

```bash
npx gitpick wevm/mpay/examples/streaming/single-fetch
pnpm i
```

## Usage

Start the server:

```bash
pnpm dev
```

In a separate terminal, run the client:

```bash
pnpm client
```
