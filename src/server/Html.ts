import type * as Challenge from '../Challenge.js'

/** Service Worker script that injects a one-shot Authorization header on the next navigation. */
export const serviceWorkerScript = [
  'var cred=null;',
  'self.addEventListener("install",function(){self.skipWaiting()});',
  'self.addEventListener("activate",function(e){e.waitUntil(self.clients.claim())});',
  'self.addEventListener("message",function(e){cred=e.data});',
  'self.addEventListener("fetch",function(e){',
  '  if(!cred)return;',
  '  var h=new Headers(e.request.headers);',
  '  h.set("Authorization",cred);',
  '  cred=null;',
  '  e.respondWith(fetch(new Request(e.request,{headers:h})));',
  '});',
].join('')

/** Returns a Response serving the mppx service worker script. */
export function serviceWorkerResponse(): Response {
  return new Response(serviceWorkerScript, {
    headers: { 'Content-Type': 'application/javascript' },
  })
}

/** Tagged template for syntax highlighting in editors. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  return String.raw(strings, ...values)
}

/**
 * Renders a self-contained HTML payment page for a 402 challenge.
 *
 * The page has three sections:
 * 1. **Info** — amount, description, method, realm, expiry from the challenge
 * 2. **Core script** — `window.mppx` (challenge + serializeCredential) and `mppx:complete` listener
 * 3. **Method HTML** — injected payment-method UI (or a fallback message)
 */
export function render(challenge: Challenge.Challenge, methodHtml?: string | undefined): string {
  const challengeJson = JSON.stringify(challenge)

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Required</title>
  <style>html{color-scheme:light dark}</style>
</head>
<body>
  <header>
    <h1>Payment Required</h1>
${challenge.description ? `    <p>${esc(challenge.description)}</p>\n` : ''}\
  </header>

  <main>
    <section>
      <pre>${esc(JSON.stringify(challenge, null, 2))}</pre>
    </section>
  </main>

  <script>
    window.mppx = Object.freeze({
      challenge: ${challengeJson},

      serializeCredential: function(payload, source) {
        var wire = {
          challenge: Object.assign({}, mppx.challenge, {
            request: base64url(JSON.stringify(sortKeys(mppx.challenge.request)))
          }),
          payload: payload
        };
        if (source) wire.source = source;
        return 'Payment ' + base64url(JSON.stringify(wire));
      }
    });

    function base64url(str) {
      return btoa(str).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
    }

    function sortKeys(obj) {
      var sorted = {};
      Object.keys(obj).sort().forEach(function(k) {
        var v = obj[k];
        sorted[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? sortKeys(v) : v;
      });
      return sorted;
    }

    function activateSw(reg) {
      var sw = reg.installing || reg.waiting || reg.active;
      return new Promise(function(resolve) {
        if (sw.state === 'activated') return resolve();
        sw.addEventListener('statechange', function() {
          if (sw.state === 'activated') resolve();
        });
      });
    }

    addEventListener('mppx:complete', function(e) {
      var statusEl = document.getElementById('status');
      var authorization = e.detail;
      statusEl.textContent = 'Verifying payment...';
      statusEl.style.color = '';

      // Try server-hosted SW, then fetch+blob fallback
      navigator.serviceWorker.register('/__mppx_sw.js').then(activateSw).then(function() {
        navigator.serviceWorker.controller.postMessage(authorization);
        window.location.reload();
      }).catch(function() {
        fetch(window.location.href, {
          headers: { 'Authorization': authorization }
        }).then(function(res) {
          if (!res.ok) {
            statusEl.textContent = 'Verification failed (' + res.status + ')';
            statusEl.style.color = 'red';
            return;
          }
          return res.blob().then(function(blob) {
            window.location = URL.createObjectURL(blob);
          });
        }).catch(function(err) {
          statusEl.textContent = err.message || 'Request failed';
          statusEl.style.color = 'red';
        });
      });
    });
  </script>

${methodHtml ?? '  <p>This payment method does not support browser payments.</p>'}
</body>
</html>`
}

/** @internal */
function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
