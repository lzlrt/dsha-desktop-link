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

/**
 * Whether this instance has ever paired a device.
 *
 * The roster is `dsh-remote-web-ui`'s own persisted store
 * (`$DSH_HOME/remote-web-ui-devices.json`, 0600, its documented default). It is
 * read only for this boolean — no ids, no credentials — and a missing or
 * unreadable file simply means "nothing paired yet", which is the safe answer:
 * the button then mints a token instead of opening a URL that would 401.
 * @returns whether at least one device session exists on disk.
 */
function hasPairedDevice() {
  try {
    const file = join(dshHome(), 'remote-web-ui-devices.json')
    if (!existsSync(file)) return false
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    const rows = Array.isArray(parsed) ? parsed : (parsed?.devices ?? [])
    return Array.isArray(rows) ? rows.length > 0 : Boolean(rows && Object.keys(rows).length)
  } catch {
    return false
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
  const tmp = `${file}.tmp`
  writeFileSync(tmp, `${lines.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, file)
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
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        finish(parsed && typeof parsed === 'object' ? parsed : null)
      } catch {
        finish(null)
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
    handler(_req, res) {
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
      readJsonBody(req).then((body) => {
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

  ctx.effect(() => () => {
    if (typeof disposeGlobal === 'function') disposeGlobal()
    if (typeof info === 'function') info()
    if (typeof save === 'function') save()
  }, 'dsha-desktop-link: info + config routes + index global')
}
