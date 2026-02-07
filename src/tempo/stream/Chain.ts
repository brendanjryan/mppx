import {
  type Address,
  type Client,
  createClient,
  type Hex,
  http,
  type ReadContractReturnType,
} from 'viem'
import { readContract, writeContract } from 'viem/actions'
import { ChannelClosedError, VerificationFailedError } from '../../Errors.js'
import type { SignedVoucher } from './Types.js'

const UINT128_MAX = 2n ** 128n - 1n

/**
 * Minimal ABI for the TempoStreamChannel escrow contract.
 * Only includes the functions needed for server-side verification.
 */
const escrowAbi = [
  {
    type: 'function',
    name: 'getChannel',
    inputs: [{ name: 'channelId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'payer', type: 'address' },
          { name: 'payee', type: 'address' },
          { name: 'token', type: 'address' },
          { name: 'authorizedSigner', type: 'address' },
          { name: 'deposit', type: 'uint128' },
          { name: 'settled', type: 'uint128' },
          { name: 'closeRequestedAt', type: 'uint64' },
          { name: 'finalized', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'settle',
    inputs: [
      { name: 'channelId', type: 'bytes32' },
      { name: 'cumulativeAmount', type: 'uint128' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'close',
    inputs: [
      { name: 'channelId', type: 'bytes32' },
      { name: 'cumulativeAmount', type: 'uint128' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

/**
 * On-chain channel state from the escrow contract.
 */
export type OnChainChannel = ReadContractReturnType<typeof escrowAbi, 'getChannel'>

/**
 * Read channel state from the escrow contract.
 */
export async function getOnChainChannel(
  rpcUrl: string,
  escrowContract: Address,
  channelId: Hex,
): Promise<OnChainChannel> {
  const client = createClient({ transport: http(rpcUrl) })
  return readContract(client, {
    address: escrowContract,
    abi: escrowAbi,
    functionName: 'getChannel',
    args: [channelId],
  })
}

/**
 * Verify a topUp by re-reading on-chain channel state.
 */
export async function verifyTopUpTransaction(
  rpcUrl: string,
  escrowContract: Address,
  channelId: Hex,
  previousDeposit: bigint,
): Promise<{ deposit: bigint }> {
  const channel = await getOnChainChannel(rpcUrl, escrowContract, channelId)

  if (channel.finalized) {
    throw new ChannelClosedError({ reason: 'channel is finalized on-chain' })
  }

  if (channel.deposit <= previousDeposit) {
    throw new VerificationFailedError({ reason: 'channel deposit did not increase' })
  }

  return { deposit: channel.deposit }
}

function assertUint128(amount: bigint): void {
  if (amount < 0n || amount > UINT128_MAX) {
    throw new VerificationFailedError({ reason: 'cumulativeAmount exceeds uint128 range' })
  }
}

/**
 * Submit a settle transaction on-chain.
 */
export async function settleOnChain(
  client: Client,
  escrowContract: Address,
  voucher: SignedVoucher,
): Promise<Hex> {
  assertUint128(voucher.cumulativeAmount)
  return writeContract(client, {
    account: client.account!,
    chain: client.chain,
    address: escrowContract,
    abi: escrowAbi,
    functionName: 'settle',
    args: [voucher.channelId, voucher.cumulativeAmount, voucher.signature],
  })
}

/**
 * Submit a close transaction on-chain.
 */
export async function closeOnChain(
  client: Client,
  escrowContract: Address,
  voucher: SignedVoucher,
): Promise<Hex> {
  assertUint128(voucher.cumulativeAmount)
  return writeContract(client, {
    account: client.account!,
    chain: client.chain,
    address: escrowContract,
    abi: escrowAbi,
    functionName: 'close',
    args: [voucher.channelId, voucher.cumulativeAmount, voucher.signature],
  })
}
