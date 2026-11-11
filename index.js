/**
 * dsh-desktop-link —— 宿主半区。
 *
 * 只做一件事：把两个地址交给浏览器半区，并允许在界面上改这两个地址。
 * 路由（均为同源 JSON）：
 *
 *   GET  /api/desktop-link/info
 *     → { ok, launchUrl, desktopUrl, source }
 *
 *   POST /api/desktop-link/config   { desktopUrl?, launchUrl? }
 *     → { ok, path, launchUrl, desktopUrl, source }；写入 $DSH_HOME/desktop-url.txt
 *
 *   launchUrl   点按钮时真正打开的地址（可以是中转的一次性链接）
 *   desktopUrl  桌面版 GUI 的长期地址（书签用，也是 launchUrl 的兜底）
 *
 * desktopUrl 的来源优先级（命中即停）：
 *   1. 本行 config.desktopUrl
 *   2. 环境变量 DSH_DESKTOP_URL
 *   3. $DSH_HOME/desktop-url.txt 第一行
 *   4. $DSH_HOME/remote-web-ui-registry/web.json 的 id → https://<id>.dsh-market.com
 *
 * launchUrl 额外支持 config.launchUrl / 环境变量 DSH_DESKTOP_LAUNCH_URL，
 * 用来指向 dsha-pair/bridge.py 的 /open.html（每次点都铸一枚新码）。
 * 没配 launchUrl 时，launchUrl 恒等于 desktopUrl。
 */
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Resolve `@deepseek-ai/schemastery`, which ships inside the harness
 * installation rather than as a dependency of this package.
 *
 * A bare `import` here fails with ERR_MODULE_NOT_FOUND and takes the whole
 * plugin down, so the module is located at runtime: first as a normal package
 * import from this file, then by walking up from the running `dsh` binary (the
 * harness's own node_modules), and finally by asking Node's global paths. The
 * `Config` export is omitted entirely when none of those resolve — the plugin
 * still works from config files, it just has no settings form.
 * @returns the schemastery `z` function, or undefined.
 */
function loadSchemastery() {
  const requireFrom = createRequire(import.meta.url)
  const candidates = ['@deepseek-ai/schemastery']

  // The harness entry point: .../node_modules/@deepseek-ai/dsh/lib/bin.js
  const argv1 = process.argv[1]
  if (typeof argv1 === 'string' && argv1) {
    const dir = dirname(resolve(argv1))
    candidates.push(join(dir, '..', 'node_modules', '@deepseek-ai', 'schemastery'))
    candidates.push(join(dir, 'node_modules', '@deepseek-ai', 'schemastery'))
  }
  try {
    for (const base of requireFrom.resolve.paths?.('@deepseek-ai/schemastery') ?? []) {
      candidates.push(join(base, '@deepseek-ai', 'schemastery'))
    }
  } catch {
    // resolve.paths is not on every Node build; the other candidates stand.
  }

  for (const candidate of candidates) {
    try {
      const mod = requireFrom(candidate)
      const z = mod?.default ?? mod
      if (typeof z === 'function' && typeof z.object === 'function') return z
    } catch {
      // try the next candidate
    }
  }
  return undefined
}

const z = loadSchemastery()

/**
 * Row config.
 *
 * Everything is optional. An install with no config falls through to the
 * environment, then to `desktop-url.txt`, then to the relay origin that
 * `dsh-remote-web-ui` publishes. The form exists so a phone — where there is no
 * shell to write that file with — can set the address from the GUI.
 *
 * The loader validates Config through schemastery's own `meta`/`dict` shape, so
 * a plain JSON Schema object is not interchangeable here (`undefined.validate`
 * when it tries). When schemastery cannot be located the export is omitted: no
 * settings form, but the row still activates.
 */
const configSchema = typeof z === 'function'
  ? z.object({
    desktopUrl: z.string().description(
      '桌面版 DSH 的长期地址（书签用），例如 https://xxx.dsh-market.com。'
      + '留空则依次读环境变量 DSH_DESKTOP_URL、$DSH_HOME/desktop-url.txt、'
      + 'dsh-remote-web-ui 的固定中继地址。'),
    launchUrl: z.string().description(
      '点按钮时真正打开的地址。留空则等于 desktopUrl。'
      + '填一个会临时铸配对码的端点（如 bridge.py 的 /open.html?k=…），'
      + '未配对过的手机也能一次进入。'),
  })
  : undefined

export { configSchema as Config }

function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim()
  return join(homedir(), '.dsh')
}

function urlish(value) {
  return typeof value === 'string' && /^https?:\/\/\S+$/i.test(value.trim()) ? value.trim() : ''
}

/**
 * Every URL in a hand-edited comment-friendly file under the DSH home.
 *
 * `desktop-url.txt` takes up to two lines, in this order:
 *   line 1 = desktopUrl, the long-lived desktop origin (bookmark target)
 *   line 2 = launchUrl, what a click actually opens (a minting endpoint)
 * A single line therefore means "open this one thing". `#` comments and blank
 * lines are skipped, and anything that is not http(s) is ignored rather than
 * returned half-parsed.
 * @param name - file name inside the DSH home.
 * @returns the URLs found, in file order.
 */
function readUrlLines(name) {
  try {
    const file = join(dshHome(), name)
    if (!existsSync(file)) return []
    const found = []
    for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const value = urlish(line)
      if (value) found.push(value)
    }
    return found
  } catch {
    return []
  }
}

function readRelayOrigin() {
  try {
    const file = join(dshHome(), 'remote-web-ui-registry', 'web.json')
    if (!existsSync(file)) return ''
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    const id = typeof parsed?.id === 'string' ? parsed.id.trim() : ''
    return /^[A-Za-z0-9-]{8,}$/.test(id) ? `https://${id}.dsh-market.com` : ''
  } catch {
    return ''
  }
}

function resolveUrls(config) {
  const fileUrls = readUrlLines('desktop-url.txt')
  const chain = [
    ['config', () => urlish(config?.desktopUrl)],
    ['env', () => urlish(process.env.DSH_DESKTOP_URL)],
    ['desktop-url.txt', () => fileUrls[0] ?? ''],
    ['relay-registry', readRelayOrigin],
  ]
  let desktopUrl = ''
  let source = 'unset'
  for (const [label, read] of chain) {
    const value = read()
    if (value) { desktopUrl = value; source = label; break }
  }
  // launchUrl is what a click opens. In order: the row's config, the
  // environment, line 2 of desktop-url.txt (a local minting endpoint such as
  // dsha-pair/bridge.py's /open.html?k=…), then the desktop origin itself.
  const launchUrl =
    urlish(config?.launchUrl) ||
    urlish(process.env.DSH_DESKTOP_LAUNCH_URL) ||
    fileUrls[1] ||
    desktopUrl
  return { launchUrl, desktopUrl, source }
}

/**
 * Nothing to do here — kept as the single place that maps a URL string to a
 * file line, so the write path and the read path agree on what counts as a URL.
 * @param value - candidate URL.
 * @returns the trimmed URL, or an empty string when it is not http(s).
 */
/** Minimal HTML escaping for the fallback page. */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => (
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&#39;'
  ))
}

/**
 * Whether a request came from this origin.
 *
 * Only used when the profile has no Connection service to ask. A request typed
 * into the address bar arrives with no `Origin`, so an origin-less request is
 * still allowed — but its `Host` must name this machine, which is what stops a
 * DNS-rebinding page (that one always sends its own hostname).
 * @param req - the incoming request.
 * @returns whether the request is same-origin (or origin-less but loopback-hosted).
 */
function sameOrigin(req) {
  const headers = req?.headers ?? {}
  if (String(headers['sec-fetch-site'] ?? '') === 'cross-site') return false
  const host = String(headers.host ?? '')
  if (!host) return false
  const origin = String(headers.origin ?? '')
  if (origin) {
    try {
      return new URL(origin).host === host
    } catch {
      return false
    }
  }
  return /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(host)
}

/**
 * Apply the harness's own admission check to a route.
 *
 * `webServer.register({ kind: 'exact' })` mounts outside the Connection fence —
 * that fence is applied by the `/api` gateway and by
 * `ctx.connection.fetch.register` routes only. A plugin route that reads state
 * (it hands out a pairing key) or writes it (it repoints the launcher) has to
 * ask for the same treatment, or the only thing standing between the user and a
 * cross-site write is whichever headers the attacker chose to send.
 *
 * `requestRejection()` rejects a request whose `Host`/`Origin` is not this
 * instance (403) and one with no live peer (401). Without the service we fall
 * back to `sameOrigin()`, which is weaker — no pairing state — but still pins
 * Host and Origin.
 * @param ctx - host plugin context.
 * @param req - the incoming request.
 * @returns 0 to admit, otherwise the status to answer with.
 */
function rejectionOf(ctx, req) {
  // `ctx.connection` is only populated when the service was injected; `ctx.get`
  // reads the same service without that requirement, which is what keeps this
  // working when a profile loads the plugin before the Connection service.
  // Reading `ctx.connection` throws when the service was not injected
  // (`cannot get property "connection" without inject`), so both reads are guarded:
  // `ctx.get` reads the same service without the inject requirement.
  let connection
  try { connection = ctx?.connection } catch { connection = undefined }
  if (!connection && typeof ctx?.get === 'function') {
    try { connection = ctx.get('connection') } catch { connection = undefined }
  }
  if (connection && typeof connection.requestRejection === 'function') {
    try {
      const status = connection.requestRejection(req)
      if (typeof status === 'number' && status >= 400) return status
      return 0
    } catch {
      // A throwing fence must not become an open door.
      return 403
    }
  }
  return sameOrigin(req) ? 0 : 403
}

/**
 * Send the fallback page.
 * @param res - the response.
 * @param status - HTTP status.
 * @param title - heading and document title.
 * @param body - one paragraph of outcome text.
 */
function sendPage(res, status, title, body) {
  const page = `<!doctype html><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>${escapeHtml(title)}</title>`
    + `<body style="font:15px/1.6 system-ui,-apple-system,sans-serif;padding:24px;max-width:720px;color:#222">`
    + `<h1 style="font-size:18px;margin:0 0 12px">${escapeHtml(title)}</h1>`
    + `<p style="margin:0 0 16px;word-break:break-all">${escapeHtml(body)}</p>`
    + `<p style="margin:0"><a href="/" style="color:#4d6bfe">← DSH</a></p></body>`
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(page),
    'cache-control': 'no-store',
  })
  res.end(page)
}

function cleanUrl(value) {
  return urlish(value)
}

/**
 * Persist both addresses to `$DSH_HOME/desktop-url.txt`.
 *
 * Written to a sibling temp file and renamed into place: a half-written file
 * would be read back by the next `/api/desktop-link/info` and silently point
 * the button at a truncated URL. An empty pair removes the file entirely, which
 * restores the relay-registry fallback instead of pinning a dead address.
 * @param desktopUrl - the long-lived origin, or ''.
 * @param launchUrl - what a click opens, or '' for "same as desktopUrl".
 * @returns the file path written, or '' when the file was removed.
 */
function writeUrlFile(desktopUrl, launchUrl) {
  const file = join(dshHome(), 'desktop-url.txt')
  const lines = []
  if (desktopUrl) lines.push(desktopUrl)
  // Line 2 only carries meaning next to a line 1; a lone launchUrl is written
  // as line 1 so a user who only knows the minting endpoint still gets one.
  if (launchUrl && launchUrl !== desktopUrl) {
    if (lines.length === 0) lines.push(launchUrl)
    else lines.push(launchUrl)
  }
  if (lines.length === 0) {
    try { rmSync(file, { force: true }) } catch { /* already gone */ }
    return ''
  }
  const payload = `${lines.join('\n')}\n`
  const tmp = `${file}.tmp`
  writeFileSync(tmp, payload, { encoding: 'utf8', mode: 0o600 })
  try {
    renameSync(tmp, file)
  } catch {
    // Android's proot rootfs can refuse a rename across its overlay; a direct
    // write is not atomic but it still leaves a complete file, which beats a
    // settings form that can never save.
    writeFileSync(file, payload, { encoding: 'utf8', mode: 0o600 })
    try { rmSync(tmp, { force: true }) } catch { /* best effort */ }
  }
  return file
}

/**
 * Read a small JSON request body.
 *
 * Bounded on purpose: this route is reachable from any paired device, and an
 * unbounded read would let one request hold the process's memory. The cap is
 * far above the two URLs the form sends.
 * @param req - the incoming request.
 * @returns the parsed object, or null when the body is absent, oversized, or
 * not JSON.
 */
function readJsonBody(req) {
  return new Promise((resolveBody) => {
    const chunks = []
    let size = 0
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolveBody(value)
    }
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 8192) { finish(null); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!chunks.length) return finish({})
      const text = Buffer.concat(chunks).toString('utf8')
      try {
        const parsed = JSON.parse(text)
        return finish(parsed && typeof parsed === 'object' ? parsed : null)
      } catch {
        // Not JSON. The route refused a non-JSON content type already, so this is
        // simply a malformed body — and it must not be reparsed as form data,
        // which is exactly the encoding a cross-site page can send unblocked.
        return finish(null)
      }
    })
    req.on('error', () => finish(null))
  })
}

/** Host half: publish the desktop address. */
export const inject = ['webServer']

/**
 * Register the info route and the index global.
 *
 * The browser half reads `globalThis.__DSHA_DESKTOP_LINK__` synchronously, so
 * the button is usable on first paint. `paired` tells it whether this instance
 * ever paired a device: when it never has, the client mints a token itself
 * through `/api/pair/issue` (same-origin, loopback, so the pairing service
 * answers) instead of opening a URL that would hit the harness 401 fence.
 *
 * `config` is read per request rather than captured once: the settings form
 * writes through the Host's config layer, and a request that arrived after such
 * a write must see the new value without a restart.
 * @param ctx - host plugin context carrying webServer.
 * @param config - the row's live config (`{ desktopUrl?, launchUrl? }`).
 */
export function apply(ctx, config) {
  /**
   * A Cordis config value may be a getter-backed proxy that throws when a field
   * is read outside the loader's own evaluation, so every read is guarded: a
   * failing field is treated as absent, and the chain simply continues.
   */
  const field = (name) => {
    try {
      const source = typeof config === 'function' ? config() : config
      const value = source?.[name]
      return typeof value === 'string' ? value : ''
    } catch {
      return ''
    }
  }
  const live = () => resolveUrls({ desktopUrl: field('desktopUrl'), launchUrl: field('launchUrl') })

  const disposeGlobal = ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: '__DSHA_DESKTOP_LINK__', value: live() })
  })

  const info = ctx.webServer.register({
    kind: 'exact',
    path: '/api/desktop-link/info',
    handler(req, res) {
      // `launchUrl` can carry a one-time pairing key, so this route answers only
      // a request the harness would have admitted itself.
      const denied = rejectionOf(ctx, req)
      if (denied) {
        res.writeHead(denied, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        res.end(JSON.stringify({ ok: false, error: denied === 401 ? 'unauthenticated' : 'forbidden' }))
        return
      }
      // Re-read per request: editing desktop-url.txt (or saving the settings
      // form) takes effect on the next click without restarting the profile.
      // Never let a resolve failure answer with a bare 400 — the button reads
      // this and a crash here looks exactly like "the plugin is gone".
      let payload
      try {
        payload = { ok: true, ...live() }
      } catch (error) {
        payload = { ok: false, error: String(error?.message ?? error) }
      }
      const body = JSON.stringify(payload)
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-store',
      })
      res.end(body)
    },
  })

  /**
   * Save the two addresses.
   *
   * This is the form a phone can actually reach: DSH renders a settings form
   * only for entries it considers editable, and an installed bundle's own row
   * is not always one of them. The route writes the same file the file-based
   * chain reads, so both entry points converge on one source of truth.
   *
   * POST /api/desktop-link/config  { desktopUrl?, launchUrl? }
   */
  const save = ctx.webServer.register({
    kind: 'exact',
    path: '/api/desktop-link/config',
    handler(req, res) {
      const reply = (status, payload) => {
        const body = JSON.stringify(payload)
        res.writeHead(status, {
          'content-type': 'application/json; charset=utf-8',
          'content-length': Buffer.byteLength(body),
          'cache-control': 'no-store',
        })
        res.end(body)
      }
      if (req.method !== 'POST') return reply(405, { ok: false, error: 'POST only' })
      const denied = rejectionOf(ctx, req)
      if (denied) return reply(denied, { ok: false, error: denied === 401 ? 'unauthenticated' : 'forbidden' })
      // A cross-site page can send a "simple" POST with no preflight only while
      // the body is text/plain or form-encoded, so JSON-only is the second lock:
      // reaching this route from another site now needs a preflight, and this
      // route answers none.
      const type = String(req.headers['content-type'] ?? '').toLowerCase()
      if (!type.startsWith('application/json')) {
        return reply(415, { ok: false, error: 'Content-Type must be application/json' })
      }
      readJsonBody(req).catch(() => null).then((body) => {
        if (!body) return reply(400, { ok: false, error: 'invalid JSON body' })
        const desktopUrl = cleanUrl(body.desktopUrl)
        const launchUrl = cleanUrl(body.launchUrl)
        // A supplied non-empty value that fails validation is an error, not a
        // silent "unset": the user typed something and deserves to know it was
        // rejected instead of watching the button stay grey.
        if (body.desktopUrl && !desktopUrl) {
          return reply(400, { ok: false, error: 'desktopUrl must be an http(s) URL' })
        }
        if (body.launchUrl && !launchUrl) {
          return reply(400, { ok: false, error: 'launchUrl must be an http(s) URL' })
        }
        try {
          const path = writeUrlFile(desktopUrl, launchUrl)
          return reply(200, { ok: true, path, ...live() })
        } catch (error) {
          return reply(500, { ok: false, error: String(error?.message ?? error) })
        }
      })
    },
  })

  /**
   * The no-dialog path.
   *
   * Everything the settings panel does, reachable as one URL, so a phone whose
   * WebView misbehaves — or a user with only a terminal — can still set the
   * address without touching the sidebar:
   *
   *   GET /api/desktop-link/set?desktopUrl=https://xxx.dsh-market.com
   */
  const setRoute = ctx.webServer.register({
    kind: 'exact',
    path: '/api/desktop-link/set',
    handler(req, res) {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ ok: false, error: 'GET only' }))
        return
      }
      const denied = rejectionOf(ctx, req)
      if (denied) {
        sendPage(res, denied, denied === 401 ? '需要已配对的浏览器' : '已拒绝',
          denied === 401
            ? '这个地址要在本机已经配对的浏览器里打开。先在 DSHA 里配对一次，再点这个链接。'
            : '这个地址只能从本机页面写入（跨站请求会被拒绝）。')
        return
      }
      if (!sameOrigin(req)) {
        sendPage(res, 403, '已拒绝', '这个地址只能从本机页面写入（跨站请求会被拒绝）。')
        return
      }
      let query
      try {
        query = new URL(String(req.url ?? '/'), 'http://127.0.0.1').searchParams
      } catch {
        sendPage(res, 400, '参数无法解析', '请求地址无法解析，请重新打开一次。')
        return
      }
      const rawDesktop = query.get('desktopUrl') ?? query.get('desktop') ?? ''
      const rawLaunch = query.get('launchUrl') ?? query.get('launch') ?? ''
      if (!rawDesktop && !rawLaunch) {
        sendPage(res, 400, '缺少参数',
          '用法：/api/desktop-link/set?desktopUrl=https://xxx.dsh-market.com'
          + '（可再加 &launchUrl=https://…/open.html?k=…）')
        return
      }
      const desktopUrl = cleanUrl(rawDesktop)
      const launchUrl = cleanUrl(rawLaunch)
      if ((rawDesktop && !desktopUrl) || (rawLaunch && !launchUrl)) {
        sendPage(res, 400, '地址不合法', '只接受 http(s) 地址。')
        return
      }
      try {
        const file = writeUrlFile(desktopUrl, launchUrl)
        const now = live()
        sendPage(res, 200, '已保存',
          `${file ? `已写入 ${file}。` : '已清空地址文件。'}`
          + `桌面地址：${now.desktopUrl || '（未配置）'}；点按钮打开：${now.launchUrl || '（未配置）'}。`
          + '回到 DSH 点一下按钮即可。')
      } catch (error) {
        sendPage(res, 500, '保存失败', `写入桌面地址文件时出错：${String(error?.message ?? error)}`)
      }
    },
  })

  ctx.effect(() => () => {
    if (typeof disposeGlobal === 'function') disposeGlobal()
    if (typeof info === 'function') info()
    if (typeof save === 'function') save()
    if (typeof setRoute === 'function') setRoute()
  }, 'dsha-desktop-link: info + config routes + index global')
}
