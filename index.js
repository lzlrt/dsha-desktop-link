/**
 * dsh-desktop-link —— 宿主半区。
 *
 * 只做一件事：把两个地址交给浏览器半区。
 * 唯一的路由是一条只读 JSON：
 *
 *   GET /api/desktop-link/info
 *     → { ok, launchUrl, desktopUrl, source }
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
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

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

/** Host half: publish the desktop address. */
export const inject = ['webServer']

/**
 * Register the info route, the launch route, and the index global.
 *
 * The browser half reads `globalThis.__DSHA_DESKTOP_LINK__` synchronously, so
 * the button is usable on first paint. `paired` tells it whether this instance
 * ever paired a device: when it never has, the client mints a token itself
 * through `/api/pair/issue` (same-origin, loopback, so the pairing service
 * answers) instead of opening a URL that would hit the harness 401 fence.
 * @param ctx - host plugin context carrying webServer.
 * @param config - the row's config (`{ desktopUrl?, launchUrl? }`).
 */
export function apply(ctx, config) {
  const disposeGlobal = ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: '__DSHA_DESKTOP_LINK__', value: resolveUrls(config) })
  })

  const info = ctx.webServer.register({
    kind: 'exact',
    path: '/api/desktop-link/info',
    handler(_req, res) {
      // Re-read per request: editing desktop-url.txt takes effect on the next
      // click without restarting the profile.
      const body = JSON.stringify({ ok: true, ...resolveUrls(config) })
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-store',
      })
      res.end(body)
    },
  })

  ctx.effect(() => () => {
    if (typeof disposeGlobal === 'function') disposeGlobal()
    if (typeof info === 'function') info()
  }, 'dsha-desktop-link: info route + index global')
}
