/**
 * Client half of the side-chat bundle.
 *
 * Adds one compact action to the conversation header. Activating it forks the
 * current conversation at the latest completed turn — the same independent
 * fork operation the Chat footer uses — and opens the fork in a right-Sidebar
 * tab. The tab hosts the shared embedded Conversation body, so the side chat
 * has its own composer, model, workspace, and session log; nothing it writes
 * reaches the source conversation.
 */
window.__ModuleLoader__.load({
  id: '@local/side-chat',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** This plugin's copy namespace. */
    const NS = 'sideChat'
    /** Identity of the Sidebar tab type and the tab-body cell that draws it. */
    const TAB_ID = '@local/side-chat'
    /** Discriminator recorded on every side-chat tab record. */
    const KIND = 'sidechat'
    /** Resource protocol owned by this package. */
    const PROTOCOL = 'sidechat'
    const ADDRESS_PREFIX = `dsh-resource://${PROTOCOL}/session/`
    const CHAT_SLOT = 'sidebar.sidechat.conversation'

    const en = {
      'action.label': 'Side chat',
      'action.hint': 'Fork this conversation into a side chat. It keeps its own context and leaves the main thread unchanged.',
      'action.hint.running': 'The conversation is still running. The side chat starts from the latest completed turn.',
      'action.disabled': 'Send a message first to start a side chat.',
      'action.pending': 'Creating a side chat…',
      'tab.title': 'Side chat',
      'loading': 'Preparing side chat…',
      'loadFailed': 'The side chat could not be opened.',
      'error.fork': 'Could not create the side chat. Try again.',
      'error.busy': 'A side chat is already being created.',
    }
    const zh = {
      'action.label': '侧边聊天',
      'action.hint': '从当前对话分叉出一个侧边聊天。它拥有独立上下文，不会改动主对话。',
      'action.hint.running': '主对话仍在运行。侧边聊天会从最近一个已完成的回合开始。',
      'action.disabled': '先发送一条消息，再开始侧边聊天。',
      'action.pending': '正在创建侧边聊天…',
      'tab.title': '侧边聊天',
      'loading': '正在准备侧边聊天…',
      'loadFailed': '侧边聊天打开失败。',
      'error.fork': '创建侧边聊天失败，请重试。',
      'error.busy': '正在创建另一个侧边聊天。',
    }

    const CSS = `
      .dsh-sidechat-action { position: relative; display: inline-flex; align-items: center; flex: none; }
      .dsh-sidechat-button {
        display: inline-flex;
        flex: none;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        padding: 0;
        border: 0;
        border-radius: 28px;
        background: transparent;
        color: var(--dsw-alias-label-tertiary);
        cursor: pointer;
        box-sizing: border-box;
      }
      @media (hover: hover) {
        .dsh-sidechat-button:hover:not(:disabled) {
          background: var(--dsw-alias-interactive-bg-hover);
          color: var(--dsw-alias-label-secondary);
        }
      }
      .dsh-sidechat-button:focus-visible {
        color: var(--dsw-alias-label-secondary);
        background: var(--dsw-alias-interactive-bg-hover);
      }
      .dsh-sidechat-button svg { flex: none; }
      .dsh-sidechat-button:disabled { cursor: default; opacity: 0.45; }
      .dsh-sidechat-button[data-pending='true'] { cursor: progress; opacity: 0.7; }
      .dsh-sidechat-spinner { animation: dsh-sidechat-spin 0.9s linear infinite; }
      @keyframes dsh-sidechat-spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) {
        .dsh-sidechat-spinner { animation: none; }
      }
      .dsh-sidechat-error {
        position: absolute;
        top: calc(100% + 6px);
        right: 0;
        z-index: 40;
        width: max-content;
        max-width: 260px;
        padding: 8px 10px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: var(--dsw-radius-md, 8px);
        background: var(--dsw-alias-bg-overlay);
        color: var(--dsw-alias-label-primary);
        font-size: 12px;
        line-height: 18px;
        box-shadow: 0 8px 24px color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent);
      }
      .dsh-sidechat-tab {
        display: flex;
        width: 100%;
        height: 100%;
        min-width: 0;
        min-height: 0;
      }
      .dsh-sidechat-placeholder {
        display: flex;
        flex: 1 1 auto;
        align-items: center;
        justify-content: center;
        padding: 24px;
        color: var(--dsw-alias-label-secondary);
        font-size: 13px;
        line-height: 20px;
        text-align: center;
      }
    `

    /**
     * Compose the resource address that identifies one forked side conversation.
     * @param {string} sessionId - the fork's Session id.
     * @returns {string} canonical dsh resource address.
     */
    function sideChatAddress(sessionId) {
      return `${ADDRESS_PREFIX}${encodeURIComponent(sessionId)}`
    }

    /**
     * Read the fork id out of a side-chat resource address.
     * @param {string} value - possible resource address.
     * @returns {string | undefined} the Session id, or undefined for another resource.
     */
    function parseSideChatAddress(value) {
      let url
      try {
        url = new URL(value)
      } catch (_invalidUrl) {
        return undefined
      }
      if (url.protocol !== 'dsh-resource:' || url.hostname.toLowerCase() !== PROTOCOL) return undefined
      const parts = url.pathname.split('/').filter(Boolean)
      if (parts.length !== 2 || parts[0] !== 'session') return undefined
      try {
        const sessionId = decodeURIComponent(parts[1])
        return sessionId === '' ? undefined : sessionId
      } catch (_invalidEncoding) {
        return undefined
      }
    }

    /** Resolve when the resource stream's holder releases it. */
    function waitForAbort(signal) {
      if (signal.aborted) return Promise.resolve()
      return new Promise((resolve) => {
        signal.addEventListener('abort', () => { resolve() }, { once: true })
      })
    }

    /** The speech-bubble glyph shown while idle. */
    function ChatIcon() {
      return h('svg', {
        viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': 'true', focusable: 'false',
      },
        h('rect', {
          x: 2.5, y: 2.5, width: 11, height: 8.5, rx: 2.5,
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.4,
        }),
        h('path', {
          d: 'M5 10.8V13l2.6-2.2', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4,
          strokeLinecap: 'round', strokeLinejoin: 'round',
        }),
        h('circle', { cx: 5.6, cy: 6.75, r: 0.85, fill: 'currentColor' }),
        h('circle', { cx: 8, cy: 6.75, r: 0.85, fill: 'currentColor' }),
        h('circle', { cx: 10.4, cy: 6.75, r: 0.85, fill: 'currentColor' }),
      )
    }

    /** The progress glyph shown while the fork is being created. */
    function SpinnerIcon() {
      return h('svg', {
        className: 'dsh-sidechat-spinner',
        viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': 'true', focusable: 'false',
      },
        h('circle', {
          cx: 8, cy: 8, r: 5.5, fill: 'none', stroke: 'currentColor', strokeOpacity: 0.25, strokeWidth: 1.8,
        }),
        h('path', {
          d: 'M8 2.5A5.5 5.5 0 0 1 13.5 8', fill: 'none', stroke: 'currentColor',
          strokeWidth: 1.8, strokeLinecap: 'round',
        }),
      )
    }

    /**
     * Header action: create or reveal the side chat for the current Session.
     * @param {object} props - standard Session header props plus this entry's injection.
     */
    function SideChatButton({ useSession, useAccess, useChat, t, start }) {
      const blank = useSession(value => value.blank)
      const running = useSession(value => value.running)
      const forkAllowed = useAccess('session/fork')
      const hasCompletedTurn = useChat((value) => {
        for (const turn of value.timeline.turns.values()) {
          if (turn.end !== undefined) return true
        }
        return false
      })
      const [pending, setPending] = React.useState(false)
      const [error, setError] = React.useState(null)

      React.useEffect(() => {
        if (error === null) return undefined
        const timer = window.setTimeout(() => { setError(null) }, 6000)
        return () => { window.clearTimeout(timer) }
      }, [error])

      // A Session without a completed turn has no fork boundary yet.
      if (!forkAllowed) return null
      const disabled = pending || blank || !hasCompletedTurn
      const hint = blank || !hasCompletedTurn
        ? t('action.disabled')
        : pending
          ? t('action.pending')
          : running ? t('action.hint.running') : t('action.hint')
      const onClick = () => {
        if (disabled) return
        setPending(true)
        setError(null)
        Promise.resolve().then(start)
          .then((result) => {
            if (result !== undefined && result.ok === false) setError(result.message)
          })
          .catch(() => { setError(t('error.fork')) })
          .finally(() => { setPending(false) })
      }
      return h('span', { className: 'dsh-sidechat-action', title: hint },
        h('button', {
          type: 'button',
          className: 'dsh-sidechat-button',
          'data-pending': pending ? 'true' : undefined,
          'aria-label': t('action.label'),
          'aria-busy': pending ? 'true' : undefined,
          disabled,
          onClick,
        }, pending ? h(SpinnerIcon) : h(ChatIcon)),
        error === null ? null : h('div', { className: 'dsh-sidechat-error', role: 'alert' }, error),
      )
    }

    /** Fixed Chat selection used by the embedded Conversation occurrence. */
    function FixedChatConversationView(props) {
      return h(React.Fragment, null, props.renderSlot('conversation.session', { view: 'chat' }))
    }

    /**
     * Draw the shared Conversation body for the forked Session behind this slot.
     * @param {object} props - session slot props.
     */
    function SideChatConversation({ sessionId, useSession, useConversation, useSessions, renderFactorySlot }) {
      const session = useSession(value => value)
      const conversation = useConversation(value => value)
      const active = conversation.activeTargets.size > 0
        || (!session.blank && !session.awaitingFirstTurn)
        || session.running
      const shellPhase = active ? 'active' : session.promptAttempted ? 'engaging' : 'blank'
      const summaryBlank = useSessions(state => state.byId[sessionId]?.blank)
      const settling = shellPhase === 'blank' && session.openState === 'loading' && summaryBlank !== true
      const hero = shellPhase === 'blank' && (session.openState === 'open' || summaryBlank === true)
      const phase = settling ? 'settling' : hero ? 'hero' : 'active'
      return renderFactorySlot('conversation.content', { variant: 'embedded', phase, hero }, {
        slots: { views: FixedChatConversationView },
      })
    }

    /**
     * A right-Sidebar tab body that hosts one side-chat resource.
     * @param {object} props - tab body props.
     */
    function SideChatTab({ useResource, useTabInfo, SessionProvider, renderSlot, t }) {
      const { tab } = useTabInfo()
      const resource = useResource(tab.contentId)
      const value = resource === undefined ? undefined : resource.value
      return h('div', { className: 'dsh-sidechat-tab', 'data-side-chat': KIND },
        value === undefined
          ? h('div', { className: 'dsh-sidechat-placeholder', role: 'status' },
            resource !== undefined && resource.status === 'failed' ? t('loadFailed') : t('loading'))
          : h(SessionProvider, { session: value.reference },
            renderSlot(CHAT_SLOT, {})),
      )
    }

    /**
     * Register the tab type, its resource owner, its body, and the header entry.
     * @param {object} scope - client scope exposing resources and both Sidebar faces.
     * @param {Function} t - translator bound to the side-chat namespace.
     */
    function registerSideChat(scope, t) {
      const { sessions, resources, sidebarRight, sidebarRightTabs, slots, uiWorkspace } = scope
      const creating = new Set()

      /** @returns {boolean} whether an open side-chat tab was revealed. */
      function revealExistingSideChat(mainSessionId) {
        const open = sidebarRight.openTabs.getSnapshot().filter(tab =>
          tab.sessionId === mainSessionId && tab.kind === KIND)
        if (open.length === 0) return false
        sidebarRight.openResourceIn(mainSessionId, open[open.length - 1].contentId)
        return true
      }

      /** @returns {Promise<{ ok: boolean, message?: string }>} */
      async function startSideChat(mainSessionId) {
        try {
          if (revealExistingSideChat(mainSessionId)) return { ok: true }
        } catch (error) {
          console.warn('[side-chat] could not reveal the open side chat', error)
        }
        if (creating.has(mainSessionId)) return { ok: false, message: t('error.busy') }
        creating.add(mainSessionId)
        try {
          // Capture the catalogued child before the optional title rename, so a
          // rename failure still opens the fork that was already created.
          let sideSessionId
          try {
            sideSessionId = await sessions.fork({
              sessionId: mainSessionId,
              increaseTitle: true,
              onCreated: (childId) => { sideSessionId = childId },
            })
          } catch (error) {
            console.warn('[side-chat] could not fork the conversation', error)
          }
          if (sideSessionId === undefined) return { ok: false, message: t('error.fork') }
          sidebarRight.openResourceIn(mainSessionId, sideChatAddress(sideSessionId))
          return { ok: true }
        } catch (error) {
          console.warn('[side-chat] could not open the side chat', error)
          return { ok: false, message: t('error.fork') }
        } finally {
          creating.delete(mainSessionId)
        }
      }

      // The side chat is a real independent fork; the resource retains it while
      // its tab exists so the embedded Conversation keeps its live binding.
      scope.effect(() => resources.register({
        protocol: PROTOCOL,
        async *open(address, { signal }) {
          const sideSessionId = parseSideChatAddress(address)
          if (sideSessionId === undefined) throw new Error(`side-chat: invalid address "${address}"`)
          if (signal.aborted) return
          const reference = sessions.retain(sideSessionId, { source: 'sideChat', signal })
          try {
            yield { ok: true, value: { sessionId: sideSessionId, reference } }
            await waitForAbort(signal)
          } finally {
            reference.release()
          }
        },
      }), 'side-chat: side-chat resources')

      scope.effect(() => sidebarRightTabs.register({
        id: TAB_ID,
        kind: KIND,
        patterns: [`${ADDRESS_PREFIX}**`],
        priority: 'extension',
        canOpen: address => parseSideChatAddress(address) !== undefined,
        title: () => t('tab.title'),
      }), 'side-chat: tab type')

      scope.effect(() => slots.inject('sidebar.right.pane.tab', () => slots.register({
        name: 'sidebar.right.pane.tab',
        key: TAB_ID,
        locale: NS,
        children: { [CHAT_SLOT]: { kind: 'single', scope: 'session' } },
      }, SideChatTab)), 'side-chat: tab body')

      scope.effect(() => slots.inject(CHAT_SLOT, () => slots.register({
        name: CHAT_SLOT,
      }, SideChatConversation)), 'side-chat: conversation body')

      // A side chat is a temporary fork: closing its tab archives the fork so it
      // stops and stays out of the session list. A fork the user has opened in
      // the main column is not disposable this way.
      scope.effect(() => sidebarRight.registerCloseHandler(KIND, (_mainSessionId, tab) => {
        const sideSessionId = parseSideChatAddress(tab.contentId)
        if (sideSessionId === undefined) return
        if (sidebarRight.mounted.getSnapshot() === sideSessionId) return
        Promise.resolve()
          .then(() => uiWorkspace.archiveSession(sideSessionId, { stopActivity: true }))
          .catch((error) => {
            console.warn('[side-chat] could not archive the closed side chat', error)
          })
      }), 'side-chat: close cleanup')

      scope.effect(() => slots.inject('conversation.session.header.utilities', () => slots.register({
        name: 'conversation.session.header.utilities',
        id: 'side-chat',
        order: 5,
        locale: NS,
        inject: sessionId => ({ start: () => startSideChat(sessionId) }),
      }, SideChatButton)), 'side-chat: header action')
    }

    return {
      inject: ['sessions', 'slots', 'locale', 'sidebarRight', 'uiWorkspace'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'side-chat: dictionaries')
        ctx.effect(() => {
          if (typeof document === 'undefined') return undefined
          const style = document.createElement('style')
          style.setAttribute('data-dsh-side-chat', '')
          style.textContent = CSS
          document.head.appendChild(style)
          return () => { style.remove() }
        }, 'side-chat: styles')
        ctx.inject(['resources', 'sidebarRightTabs'], scope => registerSideChat(scope, ctx.locale.bind(NS)))
      },
    }
  },
})
