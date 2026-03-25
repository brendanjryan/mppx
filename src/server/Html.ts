import type * as Challenge from '../Challenge.js'
import { content, script, serviceWorker as serviceWorkerGen } from './internal/html.gen.js'

/** Element IDs used in the payment page template. */
export const elements = {
  challenge: 'mppx-challenge',
  data: 'mppx-data',
  method: 'mppx-method',
} as const

/** Service worker that injects a one-shot Authorization header on the next navigation. */
export const serviceWorker = {
  pathname: '/__mppx_serviceWorker.js',
  script: serviceWorkerGen as string,
} as const

/**
 * Renders a self-contained HTML payment page for a 402 challenge.
 *
 * Replaces comment slots in the page template:
 * - `<!--mppx:head-->` — viewport, title, and styles
 * - `<!--mppx:data-->` — challenge + config JSON
 * - `<!--mppx:script-->` — bundled page script
 * - `<!--mppx:method-->` — method-specific HTML
 */
export type Options = {
  /** Method-specific HTML content. Must be from a trusted source (e.g. build-time generated `html.gen.ts`). */
  method: string
  config?: Record<string, unknown> | undefined
}

export type Props = Options & {
  challenge: Challenge.Challenge
}

export function render(props: Props): string {
  const data = JSON.stringify({ challenge: props.challenge, config: props.config ?? {} }).replace(
    /</g,
    '\\u003c',
  )
  return content
    .replace('<!--mppx:head-->', head)
    .replace(
      '<!--mppx:data-->',
      `<script id="${elements.data}" type="application/json">${data}</script>`,
    )
    .replace('<!--mppx:script-->', script)
    .replace(
      '<!--mppx:method-->',
      props.method,
    )
}

const html = String.raw
const head = html`
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Payment Required</title>
  <style>
    html {
      color-scheme: light dark;
    }
  </style>
`
