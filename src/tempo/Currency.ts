/** Supported base currency codes. */
export const supported = ['usd'] as const
export type SupportedCode = (typeof supported)[number]

/** Returns true if the currency string is a valid TIP-20 token address (0x + 40 hex chars). */
export function isTokenAddress(currency: string): currency is `0x${string}` {
  return /^0x[0-9a-fA-F]{40}$/.test(currency)
}

/** Returns true if the currency string is a supported base currency code. */
export function isCurrencyCode(currency: string): currency is SupportedCode {
  return (supported as readonly string[]).includes(currency)
}
