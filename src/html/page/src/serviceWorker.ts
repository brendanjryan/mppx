/// <reference lib="webworker" />

let cred: string | null = null

;(self as unknown as ServiceWorkerGlobalScope).addEventListener('install', () => {
  ;(self as unknown as ServiceWorkerGlobalScope).skipWaiting()
})
;(self as unknown as ServiceWorkerGlobalScope).addEventListener(
  'activate',
  (e: ExtendableEvent) => {
    e.waitUntil((self as unknown as ServiceWorkerGlobalScope).clients.claim())
  },
)
;(self as unknown as ServiceWorkerGlobalScope).addEventListener(
  'message',
  (e: ExtendableMessageEvent) => {
    cred = e.data
  },
)
;(self as unknown as ServiceWorkerGlobalScope).addEventListener('fetch', (e: FetchEvent) => {
  if (!cred) return
  const h = new Headers(e.request.headers)
  h.set('Authorization', cred)
  cred = null
  e.respondWith(fetch(new Request(e.request, { headers: h })))
})
