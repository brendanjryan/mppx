import { expectTypeOf, test } from 'vp/test'

import { openai } from './openai.js'

test('upstream error hooks preserve service-specific context', () => {
  openai({
    apiKey: 'test',
    onUpstreamError(context) {
      expectTypeOf(context.apiKey).toEqualTypeOf<string | undefined>()
      return { retry: false }
    },
    routes: { 'POST /v1/chat/completions': true },
  })
})
