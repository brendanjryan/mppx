import type { CallToolResult, McpError } from '@modelcontextprotocol/sdk/types.js'
import { Mcp } from 'mppx'
import { Mppx, tempo, Transport } from 'mppx/server'
import { expectTypeOf, test } from 'vp/test'

test('MCP composition preserves input, challenge, and receipt types', async () => {
  const methods = [
    tempo.charge({ currency: '0x0000000000000000000000000000000000000001', decimals: 6 }),
  ] as const
  const config = { methods, realm: 'example.test', secretKey: 'test-secret-key-test-secret-key-32' }
  const sdk = Mppx.create({ ...config, transport: Transport.mcpSdk() })
  const sdkHandler = sdk.compose(['tempo/charge', { amount: '1' }])
  const sdkResult = await sdkHandler({ _meta: {} })
  if (sdkResult.status === 402) expectTypeOf(sdkResult.challenge).toEqualTypeOf<McpError>()
  else expectTypeOf(sdkResult.withReceipt({ content: [] })).toEqualTypeOf<CallToolResult>()

  const rpc = Mppx.create({ ...config, transport: Transport.mcp() })
  const rpcResult = await rpc.compose(['tempo/charge', { amount: '1' }])({
    method: 'tools/call',
    id: 1,
  })
  if (rpcResult.status === 402) expectTypeOf(rpcResult.challenge).toEqualTypeOf<Mcp.Response>()
  else expectTypeOf(rpcResult.withReceipt({ result: {} })).toEqualTypeOf<Mcp.Response>()
})
