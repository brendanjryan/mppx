import { type Address, createClient, type Hex, http, type ReadContractReturnType } from 'viem'
import { readContract } from 'viem/actions'

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
 *
 * The txHash is treated as informational only — we don't try to prove it
 * caused this channel's deposit increase, since that would require decoding
 * tx input/logs. Instead, we simply verify the on-chain deposit increased
 * and the channel is still valid.
 */
export async function verifyTopUpTransaction(
  rpcUrl: string,
  escrowContract: Address,
  channelId: Hex,
  _txHash: Hex,
  previousDeposit: bigint,
): Promise<{ deposit: bigint }> {
  const channel = await getOnChainChannel(rpcUrl, escrowContract, channelId)

  if (channel.finalized) {
    throw new Error('Channel is finalized on-chain')
  }

  if (channel.deposit <= previousDeposit) {
    throw new Error('Channel deposit did not increase')
  }

  return { deposit: channel.deposit }
}
