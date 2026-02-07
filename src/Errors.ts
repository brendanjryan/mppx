/**
 * Base class for all payment-related errors.
 */
export abstract class PaymentError extends Error {
  /** RFC 9457 Problem Details type URI. */
  abstract readonly type: string

  /** HTTP status code. */
  readonly status: number = 402

  /** Converts the error to RFC 9457 Problem Details format. */
  toProblemDetails(challengeId?: string): PaymentError.ProblemDetails {
    return {
      type: this.type,
      title: this.name,
      status: this.status,
      detail: this.message,
      ...(challengeId && { challengeId }),
    }
  }
}

export declare namespace PaymentError {
  type ProblemDetails = {
    /** RFC 9457 Problem Details type URI. */
    type: string
    /** Human-readable summary. */
    title: string
    /** HTTP status code. */
    status: number
    /** Human-readable explanation. */
    detail: string
    /** Associated challenge ID, if applicable. */
    challengeId?: string
  }
}

/**
 * Credential is malformed (invalid base64url, bad JSON structure).
 */
export class MalformedCredentialError extends PaymentError {
  override readonly name = 'MalformedCredentialError'
  readonly type = 'https://tempoxyz.github.io/payment-auth-spec/problems/malformed-credential'

  constructor(options: MalformedCredentialError.Options = {}) {
    const { reason } = options
    super(reason ? `Credential is malformed: ${reason}.` : 'Credential is malformed.')
  }
}

export declare namespace MalformedCredentialError {
  type Options = {
    /** Reason the credential is malformed (e.g., "invalid base64url", "invalid JSON"). */
    reason?: string
  }
}

/**
 * Challenge ID is unknown, expired, or already used.
 */
export class InvalidChallengeError extends PaymentError {
  override readonly name = 'InvalidChallengeError'
  readonly type = 'https://tempoxyz.github.io/payment-auth-spec/problems/invalid-challenge'

  constructor(options: InvalidChallengeError.Options = {}) {
    const { id, reason } = options
    const idPart = id ? ` "${id}"` : ''
    const reasonPart = reason ? `: ${reason}` : ''
    super(`Challenge${idPart} is invalid${reasonPart}.`)
  }
}

export declare namespace InvalidChallengeError {
  type Options = {
    /** The invalid challenge ID. */
    id?: string
    /** Reason the challenge is invalid (e.g., "expired", "already used", "unknown"). */
    reason?: string
  }
}

/**
 * Payment proof is invalid or verification failed.
 */
export class VerificationFailedError extends PaymentError {
  override readonly name = 'VerificationFailedError'
  readonly type = 'https://tempoxyz.github.io/payment-auth-spec/problems/verification-failed'

  constructor(options: VerificationFailedError.Options = {}) {
    const { reason } = options
    super(reason ? `Payment verification failed: ${reason}.` : 'Payment verification failed.')
  }
}

export declare namespace VerificationFailedError {
  type Options = {
    /** Reason verification failed (e.g., "invalid signature", "insufficient amount"). */
    reason?: string
  }
}

/**
 * Payment has expired.
 */
export class PaymentExpiredError extends PaymentError {
  override readonly name = 'PaymentExpiredError'
  readonly type = 'https://tempoxyz.github.io/payment-auth-spec/problems/payment-expired'

  constructor(options: PaymentExpiredError.Options = {}) {
    const { expires } = options
    super(expires ? `Payment expired at ${expires}.` : 'Payment has expired.')
  }
}

export declare namespace PaymentExpiredError {
  type Options = {
    /** ISO 8601 expiration timestamp. */
    expires?: string
  }
}

/**
 * No credential was provided but payment is required.
 */
export class PaymentRequiredError extends PaymentError {
  override readonly name = 'PaymentRequiredError'
  readonly type = 'https://tempoxyz.github.io/payment-auth-spec/problems/payment-required'

  constructor(options: PaymentRequiredError.Options = {}) {
    const { description, realm } = options
    const parts = ['Payment is required']
    if (realm) parts.push(`for "${realm}"`)
    if (description) parts.push(`(${description})`)
    super(`${parts.join(' ')}.`)
  }
}

export declare namespace PaymentRequiredError {
  type Options = {
    /** Human-readable description of the payment. */
    description?: string | undefined
    /** Server realm (e.g., hostname). */
    realm?: string | undefined
  }
}

/**
 * Credential payload does not match the expected schema.
 */
export class InvalidPayloadError extends PaymentError {
  override readonly name = 'InvalidPayloadError'
  readonly type = 'https://tempoxyz.github.io/payment-auth-spec/problems/invalid-payload'

  constructor(options: InvalidPayloadError.Options = {}) {
    const { reason } = options
    super(reason ? `Credential payload is invalid: ${reason}.` : 'Credential payload is invalid.')
  }
}

export declare namespace InvalidPayloadError {
  type Options = {
    /** Reason the payload is invalid (e.g., "missing signature field"). */
    reason?: string
  }
}

/**
 * Request is malformed or contains invalid parameters.
 */
export class BadRequestError extends PaymentError {
  override readonly name = 'BadRequestError'
  override readonly status = 400
  readonly type = 'https://tempoxyz.github.io/payment-auth-spec/problems/bad-request'

  constructor(options: BadRequestError.Options = {}) {
    const { reason } = options
    super(reason ? `Bad request: ${reason}.` : 'Bad request.')
  }
}

export declare namespace BadRequestError {
  type Options = {
    /** Reason the request is invalid. */
    reason?: string
  }
}

/**
 * Insufficient balance in the payment channel.
 */
export class InsufficientBalanceError extends PaymentError {
  override readonly name = 'InsufficientBalanceError'
  override readonly status = 402
  readonly type = 'https://tempoxyz.github.io/payment-auth-spec/problems/insufficient-balance'

  constructor(options: InsufficientBalanceError.Options = {}) {
    const { reason } = options
    super(reason ? `Insufficient balance: ${reason}.` : 'Insufficient balance.')
  }
}

export declare namespace InsufficientBalanceError {
  type Options = {
    /** Reason for insufficient balance. */
    reason?: string
  }
}

/**
 * Conflict with existing channel state (e.g., concurrent stream).
 */
export class ChannelConflictError extends PaymentError {
  override readonly name = 'ChannelConflictError'
  override readonly status = 409
  readonly type = 'https://tempoxyz.github.io/payment-auth-spec/problems/channel-conflict'

  constructor(options: ChannelConflictError.Options = {}) {
    const { reason } = options
    super(reason ? `Channel conflict: ${reason}.` : 'Channel conflict.')
  }
}

export declare namespace ChannelConflictError {
  type Options = {
    /** Reason for the conflict. */
    reason?: string
  }
}

/**
 * Channel is closed or finalized.
 */
export class ChannelClosedError extends PaymentError {
  override readonly name = 'ChannelClosedError'
  override readonly status = 410
  readonly type = 'https://tempoxyz.github.io/payment-auth-spec/problems/channel-closed'

  constructor(options: ChannelClosedError.Options = {}) {
    const { reason } = options
    super(reason ? `Channel closed: ${reason}.` : 'Channel is closed.')
  }
}

export declare namespace ChannelClosedError {
  type Options = {
    /** Reason the channel is closed. */
    reason?: string
  }
}
