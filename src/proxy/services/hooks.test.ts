import { describe, expect, test } from 'vp/test'

import type * as Service from '../Service.js'
import { anthropic } from './anthropic.js'
import { openai } from './openai.js'
import { stripe } from './stripe.js'

describe('service hooks', () => {
  const onUpstreamError: Service.UpstreamErrorHandler = () => ({ retry: false })
  const rewriteResponse = (response: Response) => response

  test.each([
    [
      'openai',
      () =>
        openai({
          apiKey: 'test',
          onUpstreamError,
          rewriteResponse,
          routes: { 'POST /v1/chat/completions': true },
        }),
    ],
    [
      'anthropic',
      () =>
        anthropic({
          apiKey: 'test',
          onUpstreamError,
          rewriteResponse,
          routes: { 'POST /v1/messages': true },
        }),
    ],
    [
      'stripe',
      () =>
        stripe({
          apiKey: 'test',
          onUpstreamError,
          rewriteResponse,
          routes: { 'POST /v1/charges': true },
        }),
    ],
  ] as const)('preserves hooks for %s', (_name, createService) => {
    const service = createService()

    expect(service.onUpstreamError).toBe(onUpstreamError)
    expect(service.rewriteResponse).toBe(rewriteResponse)
  })
})
