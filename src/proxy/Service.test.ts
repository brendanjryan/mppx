import { describe, expect, test } from 'vitest'
import * as Service from './Service.js'

describe('from', () => {
  test('behavior: creates service with id and baseUrl', () => {
    const service = Service.from('api', {
      baseUrl: 'https://api.example.com',
      routes: { 'GET /v1/status': true },
    })
    expect(service.id).toBe('api')
    expect(service.baseUrl).toBe('https://api.example.com')
  })

  test('behavior: bearer sets Authorization header', async () => {
    const service = Service.from('api', {
      baseUrl: 'https://api.example.com',
      bearer: 'sk-123',
      routes: { 'GET /v1/data': true },
    })
    const req = new Request('https://example.com')
    const ctx = { request: req, service, upstreamPath: '/v1/data' }
    const result = await service.rewriteRequest!(req, ctx)
    expect(result.headers.get('authorization')).toBe('Bearer sk-123')
  })

  test('behavior: headers sets custom headers', async () => {
    const service = Service.from('api', {
      baseUrl: 'https://api.example.com',
      headers: { 'X-Api-Key': 'secret' },
      routes: { 'GET /v1/data': true },
    })
    const req = new Request('https://example.com')
    const ctx = { request: req, service, upstreamPath: '/v1/data' }
    const result = await service.rewriteRequest!(req, ctx)
    expect(result.headers.get('x-api-key')).toBe('secret')
  })

  test('behavior: multiple headers sets all headers', async () => {
    const service = Service.from('api', {
      baseUrl: 'https://api.example.com',
      headers: { 'X-Key': 'a', 'X-Secret': 'b' },
      routes: { 'GET /v1/data': true },
    })
    const req = new Request('https://example.com')
    const ctx = { request: req, service, upstreamPath: '/v1/data' }
    const result = await service.rewriteRequest!(req, ctx)
    expect(result.headers.get('x-key')).toBe('a')
    expect(result.headers.get('x-secret')).toBe('b')
  })

  test('behavior: mutate calls mutate function', async () => {
    const service = Service.from('api', {
      baseUrl: 'https://api.example.com',
      mutate: (req) => {
        req.headers.set('X-Mutated', 'yes')
        return req
      },
      routes: { 'GET /v1/data': true },
    })
    const req = new Request('https://example.com')
    const ctx = { request: req, service, upstreamPath: '/v1/data' }
    const result = await service.rewriteRequest!(req, ctx)
    expect(result.headers.get('x-mutated')).toBe('yes')
  })

  test('behavior: no auth config means no rewriteRequest', () => {
    const service = Service.from('api', {
      baseUrl: 'https://api.example.com',
      routes: { 'GET /v1/data': true },
    })
    expect(service.rewriteRequest).toBeUndefined()
  })

  test('behavior: per-endpoint options override service bearer', async () => {
    const handler: Service.IntentHandler = async () => ({
      status: 200 as const,
      withReceipt: <T>(r: T) => r,
    })
    const service = Service.from('api', {
      baseUrl: 'https://api.example.com',
      bearer: 'sk-default',
      routes: {
        'GET /v1/data': {
          pay: handler,
          options: { bearer: 'sk-override' },
        },
      },
    })
    const endpoint = service.routes['GET /v1/data']!
    const options = Service.getOptions(endpoint)
    const req = new Request('https://example.com')
    const ctx = { request: req, service, upstreamPath: '/v1/data', ...options }
    const result = await service.rewriteRequest!(req, ctx)
    expect(result.headers.get('authorization')).toBe('Bearer sk-override')
  })
})

describe('custom', () => {
  test('behavior: alias for from', () => {
    expect(Service.custom).toBe(Service.from)
  })
})

describe('getOptions', () => {
  test('behavior: returns options from endpoint object', () => {
    const handler: Service.IntentHandler = async () => ({
      status: 200 as const,
      withReceipt: <T>(r: T) => r,
    })
    const endpoint: Service.Endpoint = { pay: handler, options: { apiKey: 'sk-123' } }
    expect(Service.getOptions(endpoint)).toEqual({ apiKey: 'sk-123' })
  })

  test('behavior: returns undefined for function endpoint', () => {
    const handler: Service.IntentHandler = async () => ({
      status: 200 as const,
      withReceipt: <T>(r: T) => r,
    })
    expect(Service.getOptions(handler)).toBeUndefined()
  })

  test('behavior: returns undefined for true endpoint', () => {
    expect(Service.getOptions(true)).toBeUndefined()
  })
})

describe('any', () => {
  test('merges multiple 402 challenges into a single response', async () => {
    const h1: Service.IntentHandler = async () => ({
      status: 402 as const,
      challenge: new Response(null, {
        status: 402,
        headers: {
          'WWW-Authenticate':
            'Payment id="a", realm="api.example.com", method="tempo", intent="charge", request="e30"',
        },
      }),
    })
    const h2: Service.IntentHandler = async () => ({
      status: 402 as const,
      challenge: new Response(null, {
        status: 402,
        headers: {
          'WWW-Authenticate':
            'Payment id="b", realm="api.example.com", method="tempo", intent="session", request="e30"',
        },
      }),
    })

    const handler = Service.any([h1, h2])
    const result = await handler(new Request('https://example.com'))
    expect(result.status).toBe(402)
    if (result.status !== 402) throw new Error('expected 402')
    const header = result.challenge.headers.get('www-authenticate') || ''
    expect(header).toContain('intent="charge"')
    expect(header).toContain('intent="session"')
  })

  test('returns 200 from the matching handler when present', async () => {
    const h1: Service.IntentHandler = async () => ({
      status: 402 as const,
      challenge: new Response(null, {
        status: 402,
        headers: {
          'WWW-Authenticate':
            'Payment id="a", realm="api.example.com", method="tempo", intent="charge", request="e30"',
        },
      }),
    })
    const h2: Service.IntentHandler = async () => ({
      status: 200 as const,
      withReceipt: <T>(r: T) => r,
    })

    const handler = Service.any([h1, h2])
    const result = await handler(new Request('https://example.com'))
    expect(result.status).toBe(200)
    if (result.status !== 200) throw new Error('expected 200')
    const upstream = new Response('ok', { status: 200 })
    // Should return upstream as-is (receipt would be attached by real handler)
    expect(result.withReceipt(upstream)).toBe(upstream)
  })
})
