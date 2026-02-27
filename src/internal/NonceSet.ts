/** Default TTL for nonces without an explicit expiration (5 minutes). */
const DEFAULT_TTL = 5 * 60_000

/** Eviction threshold — run cleanup when map exceeds this size. */
const EVICTION_THRESHOLD = 10_000

/**
 * In-memory set for tracking used nonces with TTL-based eviction.
 *
 * Used for replay prevention — once a nonce is added, `has()` returns
 * `true` until the TTL expires.
 */
export class NonceSet {
  private entries = new Map<string, number>()

  /** Returns `true` if the nonce has been recorded and has not expired. */
  has(nonce: string): boolean {
    const expiry = this.entries.get(nonce)
    if (expiry === undefined) return false
    if (Date.now() > expiry) {
      this.entries.delete(nonce)
      return false
    }
    return true
  }

  /**
   * Records a nonce with an expiration time.
   *
   * @param nonce - The nonce to record.
   * @param expires - Optional ISO 8601 expiration. If not provided, uses a default TTL.
   */
  add(nonce: string, expires?: string): void {
    const expiry = expires ? new Date(expires).getTime() : Date.now() + DEFAULT_TTL
    this.entries.set(nonce, expiry)
    if (this.entries.size > EVICTION_THRESHOLD) this.evict()
  }

  private evict(): void {
    const now = Date.now()
    for (const [key, expiry] of this.entries) {
      if (now > expiry) this.entries.delete(key)
    }
  }
}
