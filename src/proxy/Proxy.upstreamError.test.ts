import { describe, expect, test, vi } from 'vp/test'

import * as Mppx from '../server/Mppx.js'
import * as Proxy from './Proxy.js'
import * as Service from './Service.js'

type CreatePaidProxyParameters = {
  fetch: typeof globalThis.fetch
  method?: 'GET' | 'POST' | undefined
  onPayment?: (() => void) | undefined
  onProxyError?: Service.UpstreamErrorHandler | undefined
  onServiceError?: Service.UpstreamErrorHandler | undefined
  rewriteRequest?: Service.Service['rewriteRequest']
}

function createPaidProxy(parameters: CreatePaidProxyParameters): Proxy.Proxy {
  const method = parameters.method ?? 'GET'
  return Proxy.create({
    fetch: parameters.fetch,
    onUpstreamError: parameters.onProxyError,
    services: [
      Service.from('api', {
        baseUrl: 'https://upstream.example',
        onUpstreamError: parameters.onServiceError,
        rewriteRequest: parameters.rewriteRequest,
        routes: {
          [`${method} /resource`]: createPaidHandler(parameters.onPayment),
        },
      }),
    ],
  })
}

function createPaidHandler(onPayment?: () => void): Service.IntentHandler {
  return async () => {
    onPayment?.()
    return {
      status: 200,
      withReceipt<response>(response: response): response {
        if (!(response instanceof Response)) throw new Mppx.MissingReceiptResponseError()
        const headers = new Headers(response.headers)
        headers.set('Payment-Receipt', 'test-receipt')
        return new Response(response.body, {
          headers,
          status: response.status,
          statusText: response.statusText,
        }) as response
      },
    }
  }
}

function paidRequest(init?: RequestInit): Request {
  const headers = new Headers(init?.headers)
  headers.set('Authorization', 'Payment test-credential')
  return new Request('https://proxy.example/api/resource', {
    ...init,
    headers,
  })
}

describe('onUpstreamError', () => {
  test('retries upstream without verifying payment again', async () => {
    const onPayment = vi.fn()
    const onUpstreamError = vi.fn((context: Service.UpstreamErrorContext) => ({
      retry: context.attempt < 3,
    })) as Service.UpstreamErrorHandler
    let attempts = 0
    const fetch = vi.fn(async () => {
      attempts++
      if (attempts < 3) return new Response('unavailable', { status: 503 })
      return Response.json({ ok: true })
    }) as typeof globalThis.fetch
    const proxy = createPaidProxy({ fetch, onPayment, onServiceError: onUpstreamError })

    const response = await proxy.fetch(paidRequest())

    expect(response.status).toBe(200)
    expect(response.headers.get('Payment-Receipt')).toBe('test-receipt')
    expect(await response.json()).toEqual({ ok: true })
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(onPayment).toHaveBeenCalledTimes(1)
    expect(onUpstreamError).toHaveBeenCalledTimes(2)
    expect(onUpstreamError).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        error: undefined,
        response: expect.objectContaining({ status: 503 }),
        service: expect.objectContaining({ id: 'api' }),
        upstreamPath: '/resource',
        upstreamRequest: expect.objectContaining({ url: 'https://upstream.example/resource' }),
      }),
    )
  })

  test('uses the proxy handler when the service has no override', async () => {
    const upstreamError = new Error('connection reset')
    const onProxyError = vi.fn((context: Service.UpstreamErrorContext) => ({
      retry: context.attempt < 2,
    })) as Service.UpstreamErrorHandler
    let attempts = 0
    const fetch = vi.fn(async () => {
      attempts++
      if (attempts === 1) throw upstreamError
      return new Response('recovered')
    }) as typeof globalThis.fetch
    const proxy = createPaidProxy({ fetch, onProxyError })

    const response = await proxy.fetch(paidRequest())

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('recovered')
    expect(response.headers.get('Payment-Receipt')).toBe('test-receipt')
    expect(onProxyError).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        error: upstreamError,
        response: undefined,
      }),
    )
  })

  test('prefers the service handler over the proxy default', async () => {
    const onProxyError = vi.fn(() => ({ retry: true as const }))
    const onServiceError = vi.fn(() => ({ retry: false as const }))
    const fetch = vi.fn(
      async () => new Response('rate limited', { status: 429 }),
    ) as typeof globalThis.fetch
    const proxy = createPaidProxy({ fetch, onProxyError, onServiceError })

    const response = await proxy.fetch(paidRequest())

    expect(response.status).toBe(429)
    expect(response.headers.get('Payment-Receipt')).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(onServiceError).toHaveBeenCalledTimes(1)
    expect(onProxyError).not.toHaveBeenCalled()
  })

  test('returns a handler fallback and attaches a receipt when it succeeds', async () => {
    const onServiceError = vi.fn(() => ({
      response: Response.json({ cached: true }),
      retry: false as const,
    }))
    const fetch = vi.fn(
      async () => new Response('unavailable', { status: 503 }),
    ) as typeof globalThis.fetch
    const proxy = createPaidProxy({ fetch, onServiceError })

    const response = await proxy.fetch(paidRequest())

    expect(response.status).toBe(200)
    expect(response.headers.get('Payment-Receipt')).toBe('test-receipt')
    expect(await response.json()).toEqual({ cached: true })
  })

  test('does not attach a receipt when an upstream error is returned', async () => {
    const fetch = vi.fn(
      async () => new Response('upstream failed', { status: 500 }),
    ) as typeof globalThis.fetch
    const proxy = createPaidProxy({ fetch })

    const response = await proxy.fetch(paidRequest())

    expect(response.status).toBe(500)
    expect(response.headers.get('Payment-Receipt')).toBeNull()
    expect(await response.text()).toBe('upstream failed')
  })

  test('preserves a POST body across delayed retries', async () => {
    const bodies: string[] = []
    const rewriteRequest = vi.fn((request: Request) => request)
    const onServiceError = vi.fn(() => ({ delay: 1, retry: true as const }))
    const fetch = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const request = new Request(input, init)
      bodies.push(await request.text())
      if (bodies.length === 1) return new Response('rate limited', { status: 429 })
      return Response.json({ ok: true })
    }) as typeof globalThis.fetch
    const proxy = createPaidProxy({
      fetch,
      method: 'POST',
      onServiceError,
      rewriteRequest,
    })

    const response = await proxy.fetch(
      paidRequest({
        body: JSON.stringify({ prompt: 'hello' }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }),
    )

    expect(response.status).toBe(200)
    expect(bodies).toEqual(['{"prompt":"hello"}', '{"prompt":"hello"}'])
    expect(rewriteRequest).toHaveBeenCalledTimes(2)
    expect(onServiceError).toHaveBeenCalledTimes(1)
  })

  test('stops a delayed retry when the client aborts', async () => {
    const controller = new AbortController()
    let handlerCalled: (() => void) | undefined
    const called = new Promise<void>((resolve) => {
      handlerCalled = resolve
    })
    const onServiceError: Service.UpstreamErrorHandler = () => {
      handlerCalled?.()
      return { delay: 60_000, retry: true }
    }
    const fetch = vi.fn(
      async () => new Response('unavailable', { status: 503 }),
    ) as typeof globalThis.fetch
    const proxy = createPaidProxy({ fetch, onServiceError })
    const response = proxy.fetch(paidRequest({ signal: controller.signal }))
    const assertion = expect(response).rejects.toThrow('stop retrying')

    await called
    controller.abort(new Error('stop retrying'))

    await assertion
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  test('also recovers free upstream routes without adding a receipt', async () => {
    const onUpstreamError = vi.fn(() => ({ retry: true as const }))
    let attempts = 0
    const fetch = vi.fn(async () => {
      attempts++
      if (attempts === 1) return new Response('unavailable', { status: 503 })
      return new Response('public resource')
    }) as typeof globalThis.fetch
    const proxy = Proxy.create({
      fetch,
      services: [
        Service.from('api', {
          baseUrl: 'https://upstream.example',
          onUpstreamError,
          routes: { 'GET /resource': true },
        }),
      ],
    })

    const response = await proxy.fetch(new Request('https://proxy.example/api/resource'))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('public resource')
    expect(response.headers.get('Payment-Receipt')).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
