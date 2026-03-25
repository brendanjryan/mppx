interface MppxGlobal {
  readonly challenge: {
    readonly id: string
    readonly realm: string
    readonly method: string
    readonly intent: string
    readonly request: Record<string, any>
    readonly expires?: string
    readonly description?: string
    [key: string]: unknown
  }
  readonly config: Record<string, unknown>
  serializeCredential(payload: unknown, source?: string): string
}

declare var mppx: MppxGlobal
