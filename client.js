window.__ModuleLoader__.load({
  id: 'dsh-desktop-link',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace owned by this plugin. */
    const NS = 'dsha-desktop-link'
    /** Server-rendered settings form — no script, so nothing there can crash a WebView. */
    const SETTINGS_PATH = '/desktop-link/settings'

    const zh = {
      'action': '打开桌面版 DSH',
      'action.short': '桌面版',
      'settings': '填桌面地址',
      'hint.unset': '还没配桌面地址：点右边的齿轮填一个，或把地址写进 ~/.dsh/desktop-url.txt',
      'form.title': '桌面版地址',
      'form.intro': '填一次就存在这台电脑上，手机和电脑都读同一份。',
      'form.desktop': '桌面版地址',
      'form.desktop.hint': '长期地址，例如 https://xxxx.dsh-market.com。留空则自动用固定中继。',
      'form.launch': '点按钮时打开的地址',
      'form.launch.hint': '留空就等于上面的地址。填中转的 /open.html 链接可以每次自动铸新配对码。',
      'form.save': '保存',
      'form.cancel': '取消',
      'form.saving': '保存中…',
      'form.saved': '已保存',
      'form.current': '当前生效',
      'form.close': '关闭',
      'source.config': '页面配置',
      'source.env': '环境变量',
      'source.desktop-url.txt': '桌面地址文件',
      'source.relay-registry': '固定中继',
      'source.unset': '未配置',
      'crash.fallback': '桌面地址面板出错了，界面其余部分不受影响。可以直接把地址写进 ~/.dsh/desktop-url.txt（第一行长期地址，第二行点按钮打开的地址）。',
    }
    const en = {
      'action': 'Open desktop DSH',
      'action.short': 'Desktop',
      'settings': 'Set desktop address',
      'hint.unset': 'No desktop address yet: click the gear to set one, or write it into ~/.dsh/desktop-url.txt',
      'form.title': 'Desktop address',
      'form.intro': 'Saved on this computer once; both the phone and the desktop read it.',
      'form.desktop': 'Desktop address',
      'form.desktop.hint': 'Long-lived origin, e.g. https://xxxx.dsh-market.com. Empty falls back to the fixed relay.',
      'form.launch': 'Address opened on click',
      'form.launch.hint': 'Empty means the same as above. Point it at a relay /open.html link to mint a fresh pair code each time.',
      'form.save': 'Save',
      'form.cancel': 'Cancel',
      'form.saving': 'Saving…',
      'form.saved': 'Saved',
      'form.current': 'In effect',
      'form.close': 'Close',
      'source.config': 'page config',
      'source.env': 'environment',
      'source.desktop-url.txt': 'address file',
      'source.relay-registry': 'fixed relay',
      'source.unset': 'not configured',
      'crash.fallback': 'The address panel failed; the rest of the UI is unaffected. Write the address into ~/.dsh/desktop-url.txt instead (line 1 the long-lived origin, line 2 what a click opens).',
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

    /* 18×18 gear, drawn at the same weight as Mark so the two sit together. */
    function Gear() {
      return h('svg', {
        viewBox: '0 0 64 64', width: 16, height: 16, 'aria-hidden': true,
        focusable: false, style: { display: 'block', flex: 'none' },
      },
      h('circle', {
        cx: 32, cy: 32, r: 9, fill: 'none', stroke: 'currentColor', strokeWidth: 5,
      }),
      h('path', {
        d: 'M32 6v10M32 48v10M6 32h10M48 32h10M13.6 13.6l7.1 7.1M43.3 43.3l7.1 7.1M50.4 13.6l-7.1 7.1M20.7 43.3l-7.1 7.1',
        fill: 'none', stroke: 'currentColor', strokeWidth: 5, strokeLinecap: 'round',
      }))
    }

    /**
     * The live address pair, shared by both sidebar items.
     *
     * The two items are separate components mounted side by side, so the
     * settings dialog's save has to reach the launcher without a page reload.
     * A module-scope store with listeners is the smallest thing that does it —
     * a window event would work too, but this keeps the shape typed in one
     * place and lets a late subscriber read the current value synchronously.
     */
    const store = (() => {
      let value = { desktopUrl: '', launchUrl: '', source: 'unset', loaded: false }
      const listeners = new Set()
      const emit = () => { for (const fn of [...listeners]) fn(value) }
      return {
        get: () => value,
        set(patch) {
          const next = { ...value, ...patch }
          if (next.desktopUrl === value.desktopUrl
            && next.launchUrl === value.launchUrl
            && next.source === value.source
            && next.loaded === value.loaded) return
          value = next
          emit()
        },
        subscribe(fn) {
          listeners.add(fn)
          return () => { listeners.delete(fn) }
        },
      }
    })()

    /**
     * Seed the store from the index global.
     *
     * The global is injected at index render time, so it can be absent on a
     * page served before the Host half loaded; in that case the info route is
     * asked once. Either way the result is pushed into the shared store so both
     * sidebar items agree.
     */
    function seed() {
      const injected = window.__DSHA_DESKTOP_LINK__
      if (injected && typeof injected === 'object') {
        store.set({
          desktopUrl: typeof injected.desktopUrl === 'string' ? injected.desktopUrl : '',
          launchUrl: typeof injected.launchUrl === 'string' ? injected.launchUrl : '',
          source: typeof injected.source === 'string' ? injected.source : 'unset',
          loaded: true,
        })
        if (injected.desktopUrl) return Promise.resolve()
      }
      return fetch('/api/desktop-link/info', {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      }).then((res) => (res.ok ? res.json() : null))
        .then((body) => {
          if (!body || !body.ok) return
          const next = {
            desktopUrl: typeof body.desktopUrl === 'string' ? body.desktopUrl : '',
            launchUrl: typeof body.launchUrl === 'string' ? body.launchUrl : '',
            source: typeof body.source === 'string' ? body.source : 'unset',
            loaded: true,
          }
          window.__DSHA_DESKTOP_LINK__ = { ...(injected || {}), ...next }
          store.set(next)
        })
        .catch(() => { /* the button stays as-is; the gear still opens */ })
    }

    /** Whether this page runs on a handset (DSHA's WebView or a phone browser). */
    function isHandset() {
      const ua = navigator.userAgent || ''
      return /Android|iPhone|iPad|iPod|HarmonyOS|Mobile/i.test(ua)
    }

    /** The URL a click should carry, or '' when nothing is configured. */
    function linkHref(value) {
      return value.launchUrl || value.desktopUrl
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

    /** The dialog's open state, shared so the launcher can open it too. */
    const dialog = (() => {
      let open = false
      const listeners = new Set()
      const emit = () => { for (const fn of [...listeners]) fn(open) }
      return {
        isOpen: () => open,
        show() { if (!open) { open = true; emit() } },
        hide() { if (open) { open = false; emit() } },
        subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn) } },
      }
    })()

    const baseButtonStyle = (wide) => ({
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
    })

    const hoverIn = (e) => {
      e.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12))'
    }
    const hoverOut = (e) => { e.currentTarget.style.background = 'transparent' }

    /**
     * Subscribe a component to one of the module-scope stores.
     *
     * Deliberately not `useSyncExternalStore`: this plugin must run on whatever
     * React the page shell ships, and the plain state+effect form works on every
     * version that has hooks at all.
     * @param source - object with `subscribe` and a getter.
     * @param read - selector from the store value to the slice worth rendering.
     * @returns the current slice, re-rendering on change.
     */
    /**
     * Last line of defence: a render-time throw inside our own tree must not
     * take the page down with it.
     *
     * DSHA runs this UI inside an Android WebView where a React error in a
     * sidebar item unmounts the whole shell — the user sees a white page while
     * the app is still alive. Nothing we render is worth that, so both sidebar
     * items are wrapped: a failure shows one line of text and the address hint
     * instead, and the rest of the GUI keeps working.
     */
    class Boundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false, message: '' }
      }

      static getDerivedStateFromError() {
        return { failed: true }
      }

      componentDidCatch(error) {
        try { console.error('dsha-desktop-link: render failed', error) } catch { /* noop */ }
      }

      render() {
        if (!this.state.failed) return this.props.children
        const t = (this.props && this.props.t) || ((key) => zh[key] || en[key] || key)
        return h('div', {
          role: 'alert',
          style: {
            padding: '8px 10px',
            fontSize: 12,
            lineHeight: 1.45,
            borderRadius: 8,
            background: 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12))',
            color: 'var(--dsw-alias-label-secondary, inherit)',
            wordBreak: 'break-word',
          },
        }, t('crash.fallback'))
      }
    }

    function useStore(source, read) {
      const [, force] = React.useState(0)
      React.useEffect(() => source.subscribe(() => force((n) => n + 1)), [source])
      return read()
    }

    /**
     * Row 1: "open the desktop DSH".
     *
     * Two paths, both deterministic:
     * - Handset: no second window exists, so a top-level navigation is the
     *   answer. It is issued after a short mint call, which a navigation (unlike
     *   `window.open`) tolerates, and DSHA then hands it to the system browser.
     * - Desktop: a plain `target="_blank"` anchor opens a second tab and leaves
     *   the current GUI alone. No script runs, so nothing can be blocked.
     *
     * With nothing configured the click opens the settings dialog instead of
     * doing nothing — that is the only way a phone user can ever get an address
     * in, since it has no shell to write the file with.
     */
    function DesktopLinkButton(props) {
      const wide = props.wide !== false
      const t = props.t || ((key) => zh[key] || en[key] || key)
      const value = useStore(store, () => store.get())
      const href = linkHref(value)

      React.useEffect(() => { seed() }, [])

      const onClick = (event) => {
        if (!href) {
          event.preventDefault()
          if (isHandset()) window.location.assign(SETTINGS_PATH)
          else dialog.show()
          return
        }
        // Let modifier-clicks and middle-clicks fall through to the anchor.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        if (!isHandset()) return   // desktop keeps the plain _blank anchor
        event.preventDefault()
        // A configured minting endpoint already hands out a fresh token, so
        // navigating there is enough; otherwise mint here.
        if (value.launchUrl && value.launchUrl !== value.desktopUrl) {
          window.location.assign(value.launchUrl)
          return
        }
        mintPairUrl().then((url) => { window.location.assign(url || value.desktopUrl) })
      }

      return h(Boundary, { t }, h('a', {
        href: href || undefined,
        target: '_blank',
        rel: 'noopener noreferrer',
        style: { ...baseButtonStyle(wide), opacity: href ? 1 : 0.45 },
        title: href || t('hint.unset'),
        'aria-label': t('action'),
        'aria-disabled': href ? undefined : 'true',
        onClick,
        onMouseEnter: hoverIn,
        onMouseLeave: hoverOut,
      },
      h(Mark),
      wide
        ? h('span', {
          style: { marginLeft: 8, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 13 },
        }, t('action.short'))
        : null))
    }

    /**
     * Row 2: the gear.
     *
     * A separate slot item rather than a modified click on the launcher: a
     * long-press has no affordance on a phone, and a second small target next
     * to the first is the one pattern that reads the same on both platforms.
     *
     * On a handset the gear is a plain link to the server-rendered form at
     * `/desktop-link/settings` — no dialog, no state, no request. The dialog is
     * kept for the desktop, where it is known to work; the phone gets the page
     * that cannot take the WebView down with it.
     */
    function DesktopLinkSettingsButton(props) {
      const wide = props.wide !== false
      const t = props.t || ((key) => zh[key] || en[key] || key)
      const onClick = (event) => {
        if (!isHandset()) return
        event.preventDefault()
        window.location.assign(SETTINGS_PATH)
      }
      return h(Boundary, { t }, h(React.Fragment, null,
        h('a', {
          href: SETTINGS_PATH,
          target: isHandset() ? undefined : '_blank',
          rel: 'noopener noreferrer',
          style: baseButtonStyle(false),
          title: t('settings'),
          'aria-label': t('settings'),
          onClick,
          onMouseEnter: hoverIn,
          onMouseLeave: hoverOut,
        }, h(Gear)),
        h(DesktopLinkSettingsDialog, { t })))
    }

    const overlayStyle = {
      position: 'fixed',
      inset: 0,
      zIndex: 2147483000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px 16px calc(16px + env(safe-area-inset-bottom, 0px))',
      background: 'rgba(0,0,0,.45)',
      // A soft keyboard shrinks the WebView without moving a fixed overlay;
      // letting the overlay itself scroll keeps the card reachable on a phone.
      overflowY: 'auto',
      overscrollBehavior: 'contain',
      WebkitOverflowScrolling: 'touch',
    }
    const cardStyle = {
      width: 'min(520px, 100%)',
      maxHeight: 'calc(100vh - 32px)',
      WebkitMaxHeight: 'calc(100vh - 32px)',
      overflow: 'auto',
      boxSizing: 'border-box',
      padding: 20,
      borderRadius: 12,
      background: 'var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-base, #fff))',
      color: 'var(--dsw-alias-label-primary, inherit)',
      boxShadow: '0 12px 40px rgba(0,0,0,.28)',
      fontFamily: 'inherit',
      fontSize: 14,
      lineHeight: 1.5,
    }
    const labelStyle = { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }
    const inputStyle = {
      width: '100%',
      boxSizing: 'border-box',
      padding: '8px 10px',
      borderRadius: 8,
      border: '1px solid var(--dsw-alias-border-weak, rgba(127,127,127,.35))',
      background: 'var(--dsw-alias-bg-base, transparent)',
      color: 'inherit',
      fontFamily: 'inherit',
      fontSize: 14,
    }
    const hintStyle = { margin: '6px 0 0', fontSize: 12, opacity: .7, lineHeight: 1.45 }
    const actionStyle = (primary) => ({
      height: 34,
      padding: '0 16px',
      borderRadius: 8,
      border: primary ? 'none' : '1px solid var(--dsw-alias-border-weak, rgba(127,127,127,.35))',
      background: primary ? 'var(--dsw-alias-brand-primary, #4d6bfe)' : 'transparent',
      color: primary ? '#fff' : 'inherit',
      fontFamily: 'inherit',
      fontSize: 14,
      cursor: 'pointer',
    })

    /**
     * The settings dialog.
     *
     * Mounted once, unconditionally, and driven by the shared open flag: a
     * dialog rendered inside the button would unmount with it, and the sidebar
     * row can re-render for unrelated reasons.
     *
     * Saving posts to the Host, which writes `desktop-url.txt` — the same file
     * the file-based resolution chain reads — and answers with the resolved
     * pair, so the form shows what actually took effect rather than what was
     * typed.
     */
    function DesktopLinkSettingsDialog(props) {
      const t = (props && props.t) || ((key) => zh[key] || en[key] || key)
      const open = useStore(dialog, () => dialog.isOpen())
      const value = useStore(store, () => store.get())
      const [desktop, setDesktop] = React.useState('')
      const [launch, setLaunch] = React.useState('')
      const [status, setStatus] = React.useState('idle')
      const [error, setError] = React.useState('')
      const fallback = t

      // Seed the fields from the live pair each time the dialog opens, so a
      // second visit never shows a stale draft.
      React.useEffect(() => {
        if (!open) return
        setDesktop(value.desktopUrl || '')
        setLaunch(value.launchUrl && value.launchUrl !== value.desktopUrl ? value.launchUrl : '')
        setStatus('idle')
        setError('')
      }, [open])

      React.useEffect(() => {
        if (!open) return
        const onKey = (event) => { if (event.key === 'Escape') dialog.hide() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [open])

      if (!open) return null

      const submit = (event) => {
        if (event && typeof event.preventDefault === 'function') event.preventDefault()
        if (status === 'saving') return
        setStatus('saving')
        setError('')
        fetch('/api/desktop-link/config', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ desktopUrl: desktop.trim(), launchUrl: launch.trim() }),
        })
          .then((res) => res.json().then((body) => ({ ok: res.ok, body })))
          .then(({ ok, body }) => {
            if (!ok || !body || body.ok !== true) {
              setError((body && body.error) || 'save failed')
              setStatus('idle')
              return
            }
            const next = {
              desktopUrl: typeof body.desktopUrl === 'string' ? body.desktopUrl : '',
              launchUrl: typeof body.launchUrl === 'string' ? body.launchUrl : '',
              source: typeof body.source === 'string' ? body.source : 'unset',
              loaded: true,
            }
            window.__DSHA_DESKTOP_LINK__ = { ...(window.__DSHA_DESKTOP_LINK__ || {}), ...next }
            store.set(next)
            setStatus('saved')
          })
          .catch((err) => { setError(String(err && err.message ? err.message : err)); setStatus('idle') })
      }

      const sourceText = (fallback(`source.${value.source}`))
      const body = []

      body.push(h('h2', {
        key: 'title',
        style: { margin: '0 0 4px', fontSize: 17, fontWeight: 650 },
      }, fallback('form.title')))
      body.push(h('p', {
        key: 'intro',
        style: { margin: '0 0 16px', fontSize: 12, opacity: .72 },
      }, fallback('form.intro')))

      if (value.desktopUrl) {
        body.push(h('p', {
          key: 'current',
          style: {
            margin: '0 0 16px', padding: '8px 10px', borderRadius: 8, fontSize: 12,
            background: 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.1))',
            wordBreak: 'break-all',
          },
        }, `${fallback('form.current')}（${sourceText}）：${value.launchUrl || value.desktopUrl}`))
      }

      body.push(h('div', { key: 'desktop', style: { marginBottom: 14 } },
        h('label', { style: labelStyle, htmlFor: 'dsh-desktop-link-desktop' }, fallback('form.desktop')),
        h('input', {
          id: 'dsh-desktop-link-desktop',
          type: 'url',
          inputMode: 'url',
          autoCapitalize: 'off',
          autoCorrect: 'off',
          spellCheck: false,
          placeholder: 'https://xxxx.dsh-market.com',
          value: desktop,
          onChange: (e) => setDesktop(e.target.value),
          style: inputStyle,
        }),
        h('p', { style: hintStyle }, fallback('form.desktop.hint'))))

      body.push(h('div', { key: 'launch', style: { marginBottom: 14 } },
        h('label', { style: labelStyle, htmlFor: 'dsh-desktop-link-launch' }, fallback('form.launch')),
        h('input', {
          id: 'dsh-desktop-link-launch',
          type: 'url',
          inputMode: 'url',
          autoCapitalize: 'off',
          autoCorrect: 'off',
          spellCheck: false,
          placeholder: 'https://…/open.html?k=…',
          value: launch,
          onChange: (e) => setLaunch(e.target.value),
          style: inputStyle,
        }),
        h('p', { style: hintStyle }, fallback('form.launch.hint'))))

      if (error) {
        body.push(h('p', {
          key: 'error',
          style: { margin: '0 0 12px', fontSize: 12, color: 'var(--dsw-alias-danger, #d64545)' },
        }, error))
      }

      body.push(h('div', {
        key: 'actions',
        style: { display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' },
      },
      status === 'saved'
        ? h('span', { style: { marginRight: 'auto', fontSize: 12, opacity: .75 } }, fallback('form.saved'))
        : null,
      h('button', {
        type: 'button',
        style: actionStyle(false),
        onClick: () => dialog.hide(),
      }, fallback('form.cancel')),
      h('button', {
        type: 'button',
        style: actionStyle(true),
        disabled: status === 'saving',
        onClick: submit,
      }, status === 'saving' ? fallback('form.saving') : fallback('form.save'))))

      // Deliberately not a <form>: an Android WebView treats a submission as a
      // top-level navigation and hands it to DSHA, and a prevented submit still
      // costs one navigation attempt. Two plain buttons have no such path.
      return h(Boundary, { t: fallback }, h('div', {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': fallback('form.title'),
        style: overlayStyle,
        onClick: (event) => { if (event.target === event.currentTarget) dialog.hide() },
      }, h('div', {
        style: cardStyle,
        onClick: (event) => event.stopPropagation(),
      }, body)))
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

        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'dsha-desktop-link-settings',
          order: 11,
          label: () => ctx.locale.bind(NS)('settings'),
          locale: NS,
        }, DesktopLinkSettingsButton))
      },
    }
  },
})
