import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import type { Plugin } from 'vite'

import * as Challenge from '../Challenge.js'
import * as Credential from '../Credential.js'
import * as Expires from '../Expires.js'
import type * as Method from '../Method.js'
import * as Html from '../server/Html.js'
import type * as z from '../zod.js'

const pageDir = path.resolve(import.meta.dirname, 'page')

export function dev<const method extends Method.Method>(options: {
  method: method
  request: z.input<method['schema']['request']>
  config?: Record<string, unknown>
  description?: string
  html?: Html.Config | undefined
  secretKey?: string
}): Plugin {
  const secretKey = options.secretKey ?? 'mppx-dev-secret'
  const htmlConfig = options.html
  return {
    name: 'mppx:dev',
    configureServer(server) {
      const intent = options.method.intent

      // oxlint-disable-next-line no-async-endpoint-handlers
      server.middlewares.use(async (req, res, next) => {
        if (req.url === Html.serviceWorker.pathname) {
          const sw = await fs.readFile(path.resolve(pageDir, 'src/serviceWorker.ts'), 'utf-8')
          res.setHeader('Content-Type', 'application/javascript')
          const transformed = await server.transformRequest(
            '/@fs/' + path.resolve(pageDir, 'src/serviceWorker.ts'),
          )
          res.end(transformed?.code ?? sw)
          return
        }

        const pathname = req.url?.split('?')[0]
        if (pathname !== '/' || !req.headers.accept?.includes('text/html')) return next()

        try {
          const request = (await import('../server/Request.js')).fromNodeListener(req, res)
          const credential = Credential.fromRequest(request)
          if (Challenge.verify(credential.challenge, { secretKey })) {
            res.setHeader('Content-Type', 'text/html')
            res.end(
              '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>html{color-scheme:light dark}</style></head><body><h1>Payment verified!</h1><p>This is the protected content.</p></body></html>',
            )
            return
          }
        } catch {}

        const challenge = Challenge.fromMethod(options.method, {
          description: options.description,
          secretKey,
          realm: 'localhost',
          request: options.request,
          expires: Expires.minutes(5),
        })

        const title = htmlConfig?.text?.title ?? 'Payment Required'
        const config = {
          ...options.config,
          ...(htmlConfig?.text ? { text: htmlConfig.text } : {}),
          ...(htmlConfig?.theme ? { theme: htmlConfig.theme } : {}),
        }
        const dataJson = JSON.stringify({ challenge, config })
        const head = `\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>${title}</title>${Html.style(htmlConfig?.theme)}`
        const page = await fs.readFile(path.resolve(pageDir, 'src/page.html'), 'utf-8')
        let methodContent = ''
        try {
          methodContent = (
            await fs.readFile(path.resolve(server.config.root, `src/${intent}.html`), 'utf-8')
          ).trimEnd()
        } catch {}

        const html = page
          .replace('<!--mppx:head-->', head)
          .replace(
            '<!--mppx:data-->',
            `<script id="${Html.elements.data}" type="application/json">${dataJson}</script>`,
          )
          .replace(
            '<!--mppx:script-->',
            `<script type="module" src="/@fs/${path.resolve(pageDir, 'src/page.ts')}"></script>`,
          )
          .replace(
            '<!--mppx:method-->',
            `${methodContent}\n  <script type="module" src="/src/${intent}.ts"></script>`,
          )

        const transformed = await server.transformIndexHtml(req.url!, html)
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.setHeader('WWW-Authenticate', Challenge.serialize(challenge))
        res.setHeader('Cache-Control', 'no-store')
        res.statusCode = 402
        res.end(transformed)
      })
    },
  }
}

/** Dev entry for a composed (multi-method) payment page. */
export type DevComposeMethodEntry<method extends Method.Method = Method.Method> = {
  method: method
  request: z.input<method['schema']['request']>
  config?: Record<string, unknown>
  description?: string
}

export function devCompose(options: {
  methods: DevComposeMethodEntry[]
  html?: Html.Config | undefined
  secretKey?: string
}): Plugin {
  const secretKey = options.secretKey ?? 'mppx-dev-secret'
  const htmlConfig = options.html

  // Map method entry scripts to their compose context (rootId, active key).
  // The `transform` hook prepends globals to the method module source so they
  // execute synchronously at the top of the module — before any imports or awaits.
  // This avoids the timing issue where separate <script type="module"> tags
  // run concurrently and overwrite shared globals.
  const composeContext = new Map<string, { rootId: string; key: string }>()

  return {
    name: 'mppx:dev-compose',
    transform(code, id) {
      // Inject compose preamble at the top of method entry modules.
      // Sets __mppx_root/__mppx_active, then creates a module-scoped `mppx` const
      // that shadows the global with eagerly-captured challenge/config values.
      // This prevents races where another method module overwrites __mppx_active
      // during an `await` (e.g. `await loadStripe()`).
      const ctx = composeContext.get(id)
      if (!ctx) return
      const preamble = [
        `window.__mppx_root="${ctx.rootId}";window.__mppx_active="${ctx.key}";`,
        `const mppx=Object.freeze({challenge:window.mppx.challenge,challenges:window.mppx.challenges,config:window.mppx.config,dispatch:window.mppx.dispatch.bind(window.mppx),serializeCredential:(p,s)=>{const _a=window.__mppx_active;window.__mppx_active="${ctx.key}";try{return window.mppx.serializeCredential(p,s)}finally{window.__mppx_active=_a}}});`,
      ].join('')
      return `${preamble}\n${code}`
    },
    configureServer(server) {
      // oxlint-disable-next-line no-async-endpoint-handlers
      server.middlewares.use(async (req, res, next) => {
        if (req.url === Html.serviceWorker.pathname) {
          const sw = await fs.readFile(path.resolve(pageDir, 'src/serviceWorker.ts'), 'utf-8')
          res.setHeader('Content-Type', 'application/javascript')
          const transformed = await server.transformRequest(
            '/@fs/' + path.resolve(pageDir, 'src/serviceWorker.ts'),
          )
          res.end(transformed?.code ?? sw)
          return
        }

        const pathname2 = req.url?.split('?')[0]
        if (pathname2 !== '/' || !req.headers.accept?.includes('text/html')) return next()

        try {
          const request = (await import('../server/Request.js')).fromNodeListener(req, res)
          const credential = Credential.fromRequest(request)
          if (Challenge.verify(credential.challenge, { secretKey })) {
            res.setHeader('Content-Type', 'text/html')
            res.end(
              '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>html{color-scheme:light dark}</style></head><body><h1>Payment verified!</h1><p>This is the protected content.</p></body></html>',
            )
            return
          }
        } catch {}

        const challenges: Record<string, unknown> = {}
        const configs: Record<string, Record<string, unknown>> = {}
        const wwwAuthHeaders: string[] = []
        const methodEntries: {
          key: string
          name: string
          intent: string
          rootId: string
          methodSrc: string
          htmlContent: string
        }[] = []

        for (const entry of options.methods) {
          const challenge = Challenge.fromMethod(entry.method, {
            description: entry.description,
            secretKey,
            realm: 'localhost',
            request: entry.request,
            expires: Expires.minutes(5),
          })
          wwwAuthHeaders.push(Challenge.serialize(challenge))
          const intent = entry.method.intent
          const key = `${entry.method.name}/${intent}`
          challenges[key] = challenge
          if (entry.config) configs[key] = entry.config

          const methodDir = path.resolve(server.config.root, `../${entry.method.name}`)
          let htmlContent = ''
          try {
            htmlContent = (
              await fs.readFile(path.resolve(methodDir, `src/${intent}.html`), 'utf-8')
            ).trimEnd()
          } catch {}

          const rootId = `${Html.elements.method}-${entry.method.name}-${intent}`
          const methodAbsPath = path.resolve(methodDir, `src/${intent}.ts`)
          const methodSrc = `/@fs/${methodAbsPath}`

          // Register compose context so the transform hook can inject the preamble
          composeContext.set(methodAbsPath, { rootId, key })

          methodEntries.push({
            key,
            name: entry.method.name,
            intent,
            rootId,
            methodSrc,
            htmlContent,
          })
        }

        // Build data JSON
        const config = {
          ...(htmlConfig?.text ? { text: htmlConfig.text } : {}),
          ...(htmlConfig?.theme ? { theme: htmlConfig.theme } : {}),
        }
        const dataJson = JSON.stringify({ challenges, configs, config }).replace(/</g, '\\u003c')

        // Build tab bar
        const tabBar = methodEntries
          .map((m, i) => {
            const panelId = `mppx-panel-${m.name}-${m.intent}`
            const tabId = `mppx-tab-${m.name}-${m.intent}`
            const cls = i === 0 ? Html.classNames.tabActive : Html.classNames.tab
            const selected = i === 0
            return `<button id="${tabId}" class="${cls}" role="tab" aria-selected="${selected}" aria-controls="${panelId}" tabindex="${selected ? 0 : -1}" data-method="${m.key}">${m.name}</button>`
          })
          .join('\n      ')

        // Build tab panels — each with its own external module script.
        // The transform hook injects __mppx_root/__mppx_active at the top of each
        // method module, so globals are set synchronously before any code runs.
        const panels = methodEntries
          .map((m, i) => {
            const panelId = `mppx-panel-${m.name}-${m.intent}`
            const tabId = `mppx-tab-${m.name}-${m.intent}`
            const hidden = i === 0 ? '' : ' hidden'
            return `<div id="${panelId}" class="${Html.classNames.tabPanel}" role="tabpanel" aria-labelledby="${tabId}" data-method="${m.key}"${hidden}>\n      <div id="${m.rootId}">${m.htmlContent}\n  <script type="module" src="${m.methodSrc}"></script></div>\n    </div>`
          })
          .join('\n    ')

        const methodContent = `<div class="${Html.classNames.tabs}" role="tablist" aria-label="Payment method">\n      ${tabBar}\n    </div>\n    ${panels}`

        const title = htmlConfig?.text?.title ?? 'Payment Required'
        const themeStyle = Html.style(htmlConfig?.theme)
        const head = `\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>${title}</title>${themeStyle}`

        const page = await fs.readFile(path.resolve(pageDir, 'src/page.html'), 'utf-8')
        const html = page
          .replace('<!--mppx:head-->', head)
          .replace(
            '<!--mppx:data-->',
            `<script id="${Html.elements.data}" type="application/json">${dataJson}</script>`,
          )
          .replace(
            '<!--mppx:script-->',
            `<script type="module" src="/@fs/${path.resolve(pageDir, 'src/page.ts')}"></script>`,
          )
          .replace(
            `<div class="${Html.classNames.method}" id="${Html.elements.method}"><!--mppx:method--></div>`,
            methodContent,
          )

        const transformed = await server.transformIndexHtml(req.url!, html)
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        for (const h of wwwAuthHeaders) res.setHeader('WWW-Authenticate', h)
        res.setHeader('Cache-Control', 'no-store')
        res.statusCode = 402
        res.end(transformed)
      })
    },
  }
}

export function build(names: string | string[]): Plugin {
  const items = Array.isArray(names) ? names : [names]
  let root: string
  return {
    name: 'mppx:emit',
    apply: 'build',
    config: () => ({
      build: {
        outDir: 'dist',
        emptyOutDir: true,
        rolldownOptions: {
          input: Object.fromEntries(items.map((name) => [name, `src/${name}.ts`])),
          output: { entryFileNames: '[name].js', format: 'es' as const },
          // Not yet in Vite's types but supported by Rolldown
          ...({ codeSplitting: false } as {}),
        },
        modulePreload: false,
        minify: true,
      },
    }),
    configResolved(config) {
      root = config.root
    },
    async closeBundle() {
      // e.g. root = src/html/tempo → method = tempo
      const method = path.basename(root)
      const output = path.resolve(root, `../../${method}/server/internal/html.gen.ts`)

      // Read shared chunks (if code splitting produced any)
      const assetsDir = path.resolve(root, 'dist/assets')
      const chunks: string[] = []
      try {
        for (const file of await fs.readdir(assetsDir)) {
          if (file.endsWith('.js'))
            chunks.push((await fs.readFile(path.resolve(assetsDir, file), 'utf-8')).trim())
        }
      } catch {}

      for (const name of items) {
        let content = ''
        try {
          content = (await fs.readFile(path.resolve(root, `src/${name}.html`), 'utf-8')).trimEnd()
        } catch {}
        const entryScript = (
          await fs.readFile(path.resolve(root, `dist/${name}.js`), 'utf-8')
        ).trim()
        // Strip chunk imports — their contents are inlined below
        const cleanedEntry = entryScript.replace(/^import\s.*?;\n?/gm, '')
        const allScripts = [...chunks, cleanedEntry].join('\n')
        const code = escapeTemplateLiteral(allScripts)
        const scriptBlock = `\n  <script type="module">\n${indent(code, 4)}\n  </script>`

        const body = [`export const html =`, `  \`\n${content}${scriptBlock}\n  \``].join('\n')
        const file = [comment(body), ``, body].join('\n')

        await fs.mkdir(path.dirname(output), { recursive: true })
        await fs.writeFile(output, file + '\n')
        console.log(`  Wrote ${output}`)
      }
    },
  }
}

export function buildPage(): Plugin {
  let root: string
  return {
    name: 'mppx:page_emit',
    apply: 'build',
    config: () => ({
      build: {
        outDir: 'dist',
        emptyOutDir: true,
        rolldownOptions: {
          input: 'src/page.ts',
          output: { entryFileNames: '[name].js', format: 'es' as const },
        },
        modulePreload: false,
        minify: true,
      },
    }),
    configResolved(config) {
      root = config.root
    },
    async closeBundle() {
      const output = path.resolve(root, '../../server/internal/html.gen.ts')
      // Build service worker separately (different global scope)
      const { build } = await import('vite')
      await build({
        root,
        logLevel: 'warn',
        configFile: false,
        build: {
          outDir: 'dist',
          emptyOutDir: false,
          rolldownOptions: {
            input: path.resolve(root, 'src/serviceWorker.ts'),
            output: { entryFileNames: 'serviceWorker.js', format: 'es' },
          },
          minify: true,
          modulePreload: false,
        },
      })

      const pageContent = (
        await fs.readFile(path.resolve(root, 'src/page.html'), 'utf-8')
      ).trimEnd()
      const pageBundledScript = escapeTemplateLiteral(
        (await fs.readFile(path.resolve(root, 'dist/page.js'), 'utf-8')).trim(),
      )
      const pageScript = `\n  <script type="module">\n${indent(pageBundledScript, 4)}\n  </script>`
      const serviceWorkerScript = (
        await fs.readFile(path.resolve(root, 'dist/serviceWorker.js'), 'utf-8')
      ).trim()

      const body = [
        `export const content = \`\n${pageContent}\``,
        ``,
        `export const script = \`${pageScript}\n  \``,
        ``,
        `export const serviceWorker = ${JSON.stringify(serviceWorkerScript)}`,
      ].join('\n')
      const file = [comment(body), ``, body].join('\n')

      await fs.mkdir(path.dirname(output), { recursive: true })
      await fs.writeFile(output, file + '\n')
      console.log(`  Wrote ${output}`)
    },
  }
}

function comment(body: string): string {
  const hash = crypto.createHash('md5').update(body).digest('hex')
  return `/* oxlint-disable */\n// Generated by \`pnpm build:html\` (hash: ${hash})`
}

function escapeTemplateLiteral(str: string): string {
  return str
    .replace(/\/\/# sourceMappingURL=.*$/m, '')
    .trim()
    .replaceAll('\\', '\\\\')
    .replaceAll('`', '\\`')
    .replaceAll('${', '\\${')
}

function indent(str: string, spaces: number): string {
  const pad = ' '.repeat(spaces)
  return str
    .split('\n')
    .map((line) => (line.trim() ? pad + line : line))
    .join('\n')
}
