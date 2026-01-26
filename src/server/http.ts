import type { IncomingMessage, ServerResponse } from 'node:http'

export type AnyRequest = Request | IncomingMessage
export type AnyResponse = ServerResponse | undefined

export function getHeader(request: AnyRequest, name: string): string | undefined {
  if (isFetchRequest(request)) return request.headers.get(name) ?? undefined
  const value = request.headers[name.toLowerCase()]
  return Array.isArray(value) ? value.join(', ') : value
}

export function isFetchRequest(request: unknown): request is Request {
  return (
    typeof request === 'object' &&
    request !== null &&
    'headers' in request &&
    typeof (request as Request).headers?.get === 'function'
  )
}

export function send402(challengeHeader: string, response?: ServerResponse): Response | true {
  if (response) {
    response.writeHead(402, { 'WWW-Authenticate': challengeHeader })
    response.end()
    return true
  }
  return new Response(null, { status: 402, headers: { 'WWW-Authenticate': challengeHeader } })
}

export function sendReceipt(receiptHeader: string, response?: ServerResponse): void {
  if (response) response.setHeader('Payment-Receipt', receiptHeader)
}
