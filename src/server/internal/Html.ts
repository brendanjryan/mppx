import type * as Challenge from '../../Challenge.js'
import { content, script, serviceWorker } from './page.js'

/** Service Worker script that injects a one-shot Authorization header on the next navigation. */
export const serviceWorkerScript: string = serviceWorker

/** Returns a Response serving the mppx service worker script. */
export function serviceWorkerResponse(): Response {
  return new Response(serviceWorkerScript, {
    headers: { 'Content-Type': 'application/javascript' },
  })
}

/**
 * Renders a self-contained HTML payment page for a 402 challenge.
 *
 * Replaces comment slots in the page template:
 * - `<!--mppx:head-->` — viewport, title, and styles
 * - `<!--mppx:data-->` — challenge + config JSON
 * - `<!--mppx:script-->` — bundled page script
 * - `<!--mppx:method-->` — method-specific HTML
 */
export function render(props: {
  challenge: Challenge.Challenge
  method?: string | undefined
  config?: Record<string, unknown> | undefined
}): string {
  const data = JSON.stringify({ challenge: props.challenge, config: props.config ?? {} })
  return content
    .replace('<!--mppx:head-->', head)
    .replace('<!--mppx:data-->', `<script id="mppx-data" type="application/json">${data}</script>`)
    .replace('<!--mppx:script-->', script)
    .replace(
      '<!--mppx:method-->',
      props.method ?? '  <p>This payment method does not support browser payments.</p>',
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
