/** Returns an ISO 8601 datetime string `n` days from now. */
export function day(n: number) {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString()
}

/** Returns an ISO 8601 datetime string `n` hours from now. */
export function hour(n: number) {
  return new Date(Date.now() + n * 60 * 60 * 1000).toISOString()
}

/** Returns an ISO 8601 datetime string `n` minutes from now. */
export function minute(n: number) {
  return new Date(Date.now() + n * 60 * 1000).toISOString()
}

/** Returns an ISO 8601 datetime string `n` months (30 days) from now. */
export function month(n: number) {
  return new Date(Date.now() + n * 30 * 24 * 60 * 60 * 1000).toISOString()
}

/** Returns an ISO 8601 datetime string `n` seconds from now. */
export function second(n: number) {
  return new Date(Date.now() + n * 1000).toISOString()
}

/** Returns an ISO 8601 datetime string `n` weeks from now. */
export function week(n: number) {
  return new Date(Date.now() + n * 7 * 24 * 60 * 60 * 1000).toISOString()
}

/** Returns an ISO 8601 datetime string `n` years (365 days) from now. */
export function year(n: number) {
  return new Date(Date.now() + n * 365 * 24 * 60 * 60 * 1000).toISOString()
}
