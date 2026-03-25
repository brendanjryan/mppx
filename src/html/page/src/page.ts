const dataEl = document.getElementById('mppx-data') as HTMLScriptElement
const { challenge, config } = JSON.parse(dataEl.textContent!) as {
  challenge: MppxGlobal['challenge']
  config: Record<string, unknown>
}

// --- Globals ---

function base64url(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function sortKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {}
  Object.keys(obj)
    .sort()
    .forEach((k) => {
      const v = obj[k]
      sorted[k] =
        v && typeof v === 'object' && !Array.isArray(v) ? sortKeys(v as Record<string, unknown>) : v
    })
  return sorted
}

;(window as any).mppx = Object.freeze({
  challenge,
  config,
  serializeCredential(payload: unknown, source?: string): string {
    const wire: Record<string, unknown> = {
      challenge: Object.assign({}, mppx.challenge, {
        request: base64url(
          JSON.stringify(sortKeys(mppx.challenge.request as Record<string, unknown>)),
        ),
      }),
      payload,
    }
    if (source) wire.source = source
    return 'Payment ' + base64url(JSON.stringify(wire))
  },
})

// --- Populate challenge display ---

const challengeEl = document.getElementById('mppx-challenge')!
challengeEl.textContent = JSON.stringify(challenge, null, 2)

// --- Description ---

if (challenge.description) {
  const p = document.createElement('p')
  p.textContent = challenge.description
  document.querySelector('header')!.appendChild(p)
}

// --- Service worker & mppx:complete ---

function activateSw(reg: ServiceWorkerRegistration): Promise<void> {
  const sw = reg.installing || reg.waiting || reg.active
  return new Promise((resolve) => {
    if (sw!.state === 'activated') return resolve()
    sw!.addEventListener('statechange', () => {
      if (sw!.state === 'activated') resolve()
    })
  })
}

addEventListener('mppx:complete', ((e: CustomEvent<string>) => {
  const statusEl = document.getElementById('status')
  const authorization = e.detail
  if (statusEl) {
    statusEl.textContent = 'Verifying payment...'
    statusEl.style.color = ''
  }

  navigator.serviceWorker
    .register('/__mppx_serviceWorker.js')
    .then(activateSw)
    .then(() => {
      function sendAndReload() {
        navigator.serviceWorker.controller!.postMessage(authorization)
        window.location.reload()
      }
      if (navigator.serviceWorker.controller) sendAndReload()
      else navigator.serviceWorker.addEventListener('controllerchange', sendAndReload)
    })
    .catch(() => {
      fetch(window.location.href, {
        headers: { Authorization: authorization },
      })
        .then((res) => {
          if (!res.ok) {
            if (statusEl) {
              statusEl.textContent = 'Verification failed (' + res.status + ')'
              statusEl.style.color = 'red'
            }
            return
          }
          return res.blob().then((blob) => {
            window.location = URL.createObjectURL(blob) as any
          })
        })
        .catch((err) => {
          if (statusEl) {
            statusEl.textContent = err.message || 'Request failed'
            statusEl.style.color = 'red'
          }
        })
    })
}) as EventListener)
