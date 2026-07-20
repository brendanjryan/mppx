import type * as Types from './Types.js'

/**
 * Wraps a fetch implementation so every outbound request is attested.
 *
 * Configure this wrapper as the underlying `fetch` passed to `mppx/client`
 * `Fetch.from()`. MPPX then uses it for both the initial request and its
 * automatic request containing an `Authorization: Payment` credential.
 */
export function wrapFetch(
  fetch: typeof globalThis.fetch,
  signer: Types.Signer,
): typeof globalThis.fetch {
  return async (input, init) => fetch(await signer.sign(new Request(input, init)))
}
