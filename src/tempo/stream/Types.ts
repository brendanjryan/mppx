import type { Address, Hex } from 'viem'

/**
 * Voucher for cumulative payment.
 * Cumulative monotonicity prevents replay attacks.
 */
export interface Voucher {
  channelId: Hex
  cumulativeAmount: bigint
}

/**
 * Signed voucher with EIP-712 signature.
 */
export interface SignedVoucher extends Voucher {
  signature: Hex
}

/**
 * Stream credential payload (discriminated union).
 */
export type StreamCredentialPayload =
  | {
      action: 'open'
      type: 'transaction'
      channelId: Hex
      transaction: Hex
      signature: Hex
      authorizedSigner?: Address | undefined
      cumulativeAmount: string
    }
  | {
      action: 'topUp'
      type: 'transaction'
      channelId: Hex
      transaction: Hex
      additionalDeposit: string
    }
  | {
      action: 'voucher'
      channelId: Hex
      cumulativeAmount: string
      signature: Hex
    }
  | {
      action: 'close'
      channelId: Hex
      cumulativeAmount: string
      signature: Hex
    }

/**
 * Stream receipt returned in Payment-Receipt header.
 */
export interface StreamReceipt {
  method: 'tempo'
  intent: 'stream'
  status: 'success'
  timestamp: string
  /** Payment reference (channelId). Satisfies Receipt.Receipt contract. */
  reference: string
  challengeId: string
  channelId: Hex
  acceptedCumulative: string
  spent: string
  units?: number | undefined
  txHash?: Hex | undefined
}
