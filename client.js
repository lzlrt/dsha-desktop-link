window.__ModuleLoader__.load({
  id: '@local/dsha-desktop-link',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace owned by this plugin. */
    const NS = 'dsha-desktop-link'

    const zh = {
      'action': '打开桌面版 DSH',
      'action.short': '桌面版',
      'hint.unset': '还没配桌面地址：把地址写进 ~/.dsh/desktop-url.txt（一行一个 URL）',
    }
    const en = {
      'action': 'Open desktop DSH',
      'action.short': 'Desktop',
      'hint.unset': 'No desktop address yet: put one in ~/.dsh/desktop-url.txt (one URL per line)',
    }

    /* 18×18 monitor with an out-arrow — same artwork as icon.svg, inlined so
       the button costs no extra request. */
    function Mark() {
      return h('svg', {
        viewBox: '0 0 64 64', width: 18, height: 18, 'aria-hidden': true,
        focusable: false,
        style: { display: 'block', flex: 'none' },
      },
      h('rect', {
        x: 8, y: 10, width: 48, height: 30, rx: 5,
        fill: 'none', stroke: 'currentColor', strokeWidth: 4.5,
      }),
      h('path', {
        d: 'M26 54h12M32 46v8', fill: 'none', stroke: 'currentColor',
        strokeWidth: 4.5, strokeLinecap: 'round',
      }),
      h('path', {
        d: 'M24 25h14M32 18l7 7-7 7', fill: 'none', stroke: 'currentColor',
        strokeWidth: 4.5, strokeLinecap: 'round', strokeLinejoin: 'round',
      }))
    }

    /**
     * The addresses the host published so far. Both empty means the host half
     * resolved nothing — the button then renders disabled with a hint instead
     * of sending the browser to an address nobody configured.
     */
    function published() {
      const injected = window.__DSHA_DESKTOP_LINK__
      const desktopUrl = injected && typeof injected.desktopUrl === 'string' ? injected.desktopUrl : ''
      const launchUrl = injected && typeof injected.launchUrl === 'string' ? injected.launchUrl : ''
      return { desktopUrl, launchUrl }
    }

    /**
     * Fill in from the info route when the index global is absent.
     *
     * The global comes from `webserver/index-inject`, so it only appears on an
     * index rendered after the Host half loaded; the route answers on the
     * running Host either way. Cached on the window so later renders and clicks
     * agree without another request.
     * @returns the published addresses, once known.
     */
    function hydrate() {
      const injected = window.__DSHA_DESKTOP_LINK__
      if (injected && injected.desktopUrl) return Promise.resolve(published())
      return fetch('/api/desktop-link/info', {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      }).then((res) => (res.ok ? res.json() : null))
        .then((body) => {
          if (!body || typeof body.desktopUrl !== 'string' || !body.desktopUrl) return published()
          const merged = {
            desktopUrl: body.desktopUrl,
            launchUrl: typeof body.launchUrl === 'string' ? body.launchUrl : '',
            paired: Boolean(body.paired),
          }
          window.__DSHA_DESKTOP_LINK__ = merged
          return merged
        })
        .catch(() => published())
    }

    /** Whether this page runs on a handset (DSHA's WebView or a phone browser). */
    function isHandset() {
      const ua = navigator.userAgent || ''
      return /Android|iPhone|iPad|iPod|HarmonyOS|Mobile/i.test(ua)
    }

    /**
     * Mint a one-shot pair URL from this instance's own pairing service.
     *
     * This page is same-origin on the loopback listener and `/api/pair/issue`
     * answers loopback only, so the browser can ask on the phone's behalf. A
     * phone that has never paired would otherwise open the published origin and
     * meet the harness 401 fence; after one pairing the cookie lasts a year.
     * An instance without the pairing plugin answers 404 — a handled miss.
     * @returns the pair-accept URL, or an empty string.
     */
    function mintPairUrl() {
      return fetch('/api/pair/issue', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: '{}',
      }).then((res) => (res.ok ? res.json() : null))
        .then((body) => (body && typeof body.url === 'string' ? body.url : ''))
        .catch(() => '')
    }

    /**
     * The URL the anchor carries, so middle-click and "copy link" stay
     * meaningful. A configured `launchUrl` wins, else the desktop origin.
     * @returns the absolute URL.
     */
    function linkHref() {
      const { desktopUrl, launchUrl } = published()
      return launchUrl || desktopUrl
    }

    /**
     * Handset click: navigate this page to a freshly minted pair URL.
     *
     * A top-level navigation needs no user gesture, so this survives the await
     * that the popup-blocked `window.open` variant did not. The DSHA WebView
     * sees the navigation leave its own service and hands it to the system
     * browser, which is exactly the desired jump.
     * @param fallback - the URL to use when minting is unavailable.
     */
    function openOnHandset(fallback) {
      mintPairUrl().then((url) => { window.location.assign(url || fallback) })
    }

    /**
     * Sidebar-foot button: "open the desktop DSH".
     *
     * Two paths, both deterministic:
     * - Handset: no second window exists, so a top-level navigation is the
     *   answer. It is issued after a short mint call, which a navigation (unlike
     *   `window.open`) tolerates, and DSHA then hands it to the system browser.
     * - Desktop: a plain `target="_blank"` anchor opens a second tab and leaves
     *   the current GUI alone. No script runs, so nothing can be blocked.
     */
    function DesktopLinkButton(props) {
      const wide = props.wide !== false
      const t = props.t || ((key) => zh[key] || en[key] || key)
      const [href, setHref] = React.useState(() => linkHref())
      React.useEffect(() => {
        let alive = true
        hydrate().then(() => { if (alive) setHref(linkHref()) })
        return () => { alive = false }
      }, [])

      const onClick = (event) => {
        // Nothing configured: stay inert and let the title/hint explain why.
        if (!href) { event.preventDefault(); return }
        // Let modifier-clicks and middle-clicks fall through to the anchor.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        if (!isHandset()) return   // desktop keeps the plain _blank anchor
        event.preventDefault()
        // A configured minting endpoint already hands out a fresh token, so
        // navigating there is enough; otherwise mint here.
        const { desktopUrl, launchUrl } = published()
        if (launchUrl && launchUrl !== desktopUrl) {
          window.location.assign(launchUrl)
          return
        }
        openOnHandset(desktopUrl)
      }

      const style = {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: wide ? 'flex-start' : 'center',
        flex: 'none',
        height: 28,
        minWidth: 28,
        padding: wide ? '0 8px' : 0,
        boxSizing: 'border-box',
        borderRadius: 'var(--dsw-radius-sm, 6px)',
        color: 'var(--dsw-alias-label-secondary)',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        fontSize: 13,
        fontFamily: 'inherit',
        textDecoration: 'none',
        whiteSpace: 'nowrap',
      }

      return h('a', {
        href,
        target: '_blank',
        rel: 'noopener noreferrer',
        style: { ...style, opacity: href ? 1 : 0.45 },
        title: href || t('hint.unset'),
        'aria-label': t('action'),
        'aria-disabled': href ? undefined : 'true',
        onClick,
        onMouseEnter: (e) => {
          e.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12))'
        },
        onMouseLeave: (e) => { e.currentTarget.style.background = 'transparent' },
      },
      h(Mark),
      wide
        ? h('span', {
          style: { marginLeft: 8, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 13 },
        }, t('action.short'))
        : null)
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          const offZh = ctx.locale.register(NS, 'zh', zh)
          const offEn = ctx.locale.register(NS, 'en', en)
          return () => { offZh(); offEn() }
        }, 'dsha-desktop-link: dictionaries')

        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'dsha-desktop-link',
          order: 10,
          label: () => ctx.locale.bind(NS)('action'),
          locale: NS,
        }, DesktopLinkButton))
      },
    }
  },
})
