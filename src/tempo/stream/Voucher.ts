import type { Address } from 'ox'
import { SignatureEnvelope } from 'ox/tempo'
import type { Account, Client, Hex } from 'viem'
import { isAddressEqual, recoverTypedDataAddress } from 'viem'
import { signTypedData } from 'viem/actions'
import type { SignedVoucher, Voucher } from './Types.js'

/** Must match the on-chain TempoStreamChannel DOMAIN_SEPARATOR name. */
const DOMAIN_NAME = 'Tempo Stream Channel'
/** Must match the on-chain TempoStreamChannel DOMAIN_SEPARATOR version. */
const DOMAIN_VERSION = '1'

/**
 * EIP-712 domain for voucher signing.
 */
function getVoucherDomain(escrowContract: Address.Address, chainId: number) {
  return {
    name: DOMAIN_NAME,
    version: DOMAIN_VERSION,
    chainId,
    verifyingContract: escrowContract,
  } as const
}

/**
 * EIP-712 types for voucher signing.
 * Matches @tempo/stream-channels/voucher and on-chain VOUCHER_TYPEHASH.
 */
const voucherTypes = {
  Voucher: [
    { name: 'channelId', type: 'bytes32' },
    { name: 'cumulativeAmount', type: 'uint128' },
  ],
} as const

/**
 * Sign a voucher with an account.
 */
export async function signVoucher(
  client: Client,
  account: Account,
  message: Voucher,
  escrowContract: Address.Address,
  chainId: number,
): Promise<Hex> {
  return signTypedData(client, {
    account,
    domain: getVoucherDomain(escrowContract, chainId),
    types: voucherTypes,
    primaryType: 'Voucher',
    message: {
      channelId: message.channelId,
      cumulativeAmount: message.cumulativeAmount,
    },
  })
}

/**
 * Verify a voucher signature matches the expected signer.
 *
 * Supports direct signatures (secp256k1/p256/webAuthn).
 * Keychain (access key) signatures are currently rejected because
 * `SignatureEnvelope.verify` does not support them and accepting
 * based on `userAddress` alone would skip cryptographic verification.
 */
export async function verifyVoucher(
  escrowContract: Address.Address,
  chainId: number,
  voucher: SignedVoucher,
  expectedSigner: Address.Address,
): Promise<boolean> {
  try {
    const domain = getVoucherDomain(escrowContract, chainId)
    const message = {
      channelId: voucher.channelId,
      cumulativeAmount: voucher.cumulativeAmount,
    }

    const envelope = SignatureEnvelope.from(voucher.signature as SignatureEnvelope.Serialized)

    if (envelope.type === 'keychain') return false

    const signer = await recoverTypedDataAddress({
      domain,
      types: voucherTypes,
      primaryType: 'Voucher',
      message,
      signature: voucher.signature,
    })
    return isAddressEqual(signer, expectedSigner)
  } catch {
    return false
  }
}

/**
 * Parse a voucher from credential payload.
 */
export function parseVoucherFromPayload(
  channelId: Hex,
  cumulativeAmount: string,
  signature: Hex,
): SignedVoucher {
  return {
    channelId,
    cumulativeAmount: BigInt(cumulativeAmount),
    signature,
  }
}
