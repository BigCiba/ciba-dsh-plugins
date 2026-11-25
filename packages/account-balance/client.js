/**
 * Client half of the account-balance bundle.
 *
 * Renders one compact balance row in `sidebar.footer.action`, which the
 * sidebar stacks directly above the account launcher at the foot of the
 * column. The row is additive: it never shadows the shipped account launcher.
 * Balance reads reuse the account plugin's public extension points — the
 * `accountUi` service (client metadata plus signed-in state) and its
 * `account-ui/change` / `account-ui/refresh` events — so the Host owns the
 * credential and this module only ever sees the wallet projection.
 */
window.__ModuleLoader__.load({
  id: '@local/account-balance',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NAMESPACE = 'account.balance'
    const SYMBOLS = { CNY: '¥', USD: '$' }
    /** Periodic re-read while the page is visible; the account session is the Host's, not ours. */
    const REFRESH_INTERVAL_MS = 180000
    /** A focus or visibility change inside this window reuses the last attempt, failure included. */
    const MIN_ATTEMPT_GAP_MS = 60000

    const en = {
      label: 'Balance',
      loading: 'Reading balance…',
      unavailable: 'Unavailable',
      refresh: 'Refresh balance',
      retry: 'Click to retry',
      updated: 'updated {time}',
      stale: 'last refresh failed',
      bonus: 'Bonus',
      aria: 'Balance {amount}. Click to refresh.',
      ariaFailed: 'Balance unavailable. Click to retry.',
    }
    const zh = {
      label: '余额',
      loading: '正在读取余额…',
      unavailable: '暂不可用',
      refresh: '刷新余额',
      retry: '点击重试',
      updated: '更新于 {time}',
      stale: '上次刷新失败',
      bonus: '赠金',
      aria: '余额 {amount}，点击刷新。',
      ariaFailed: '余额暂不可用，点击重试。',
    }

    /** React 18 ships useSyncExternalStore; fall back only for an older shared table. */
    const useStoreValue = React.useSyncExternalStore !== undefined
      ? React.useSyncExternalStore
      : (subscribe, getSnapshot) => {
        const [value, setValue] = React.useState(getSnapshot)
        React.useEffect(() => {
          setValue(getSnapshot())
          return subscribe(() => { setValue(getSnapshot()) })
        }, [subscribe, getSnapshot])
        return value
      }

    /**
     * Split a decimal string into sign, integer digits, and fraction digits.
     * Wallet amounts arrive as decimal strings, including exponent forms such
     * as `0E-16`; no binary floating point is involved.
     */
    function decimalParts(raw) {
      const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(String(raw).trim())
      if (match === null) return null
      const sign = match[1] === '-' ? -1 : 1
      const integerPart = match[2] === '' ? '0' : match[2]
      const fractionPart = match[3] === undefined ? '' : match[3]
      const exponent = match[4] === undefined ? 0 : Number(match[4])
      if (!Number.isSafeInteger(exponent)) return null
      const digits = integerPart + fractionPart
      const point = integerPart.length + exponent
      let integer
      let fraction
      if (point <= 0) {
        integer = '0'
        fraction = '0'.repeat(-point) + digits
      } else if (point >= digits.length) {
        integer = digits + '0'.repeat(point - digits.length)
        fraction = ''
      } else {
        integer = digits.slice(0, point)
        fraction = digits.slice(point)
      }
      return { sign, integer: integer.replace(/^0+(?=\d)/, ''), fraction }
    }

    /** Whole cents, truncating the third and later fraction digits. */
    function truncatedCents(parts) {
      return BigInt(`${parts.integer === '' ? '0' : parts.integer}${parts.fraction.slice(0, 2).padEnd(2, '0')}`)
    }

    /** Insert digit grouping into a non-negative integer string. */
    function groupInteger(digits) {
      return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    }

    /** Render whole cents as `symbol<grouped whole>.<two digits>`. */
    function centsText(cents, symbol) {
      return `${symbol}${groupInteger((cents / 100n).toString())}.${(cents % 100n).toString().padStart(2, '0')}`
    }

    /**
     * Format one wallet amount with Platform Web's rules: positive amounts
     * truncate to cents and read `<¥0.01` below one cent, negative amounts
     * round half-up on the magnitude with a one-cent display floor, and zero
     * reads `¥0.00`.
     */
    function formatAmount(raw, currency) {
      const symbol = SYMBOLS[currency] === undefined ? '' : SYMBOLS[currency]
      const parts = decimalParts(raw)
      if (parts === null) return `${symbol}${raw}`
      if ((parts.integer + parts.fraction).replace(/0/g, '') === '') return `${symbol}0.00`
      const truncated = truncatedCents(parts)
      if (parts.sign > 0) {
        return truncated === 0n ? `<${symbol}0.01` : centsText(truncated, symbol)
      }
      // Decimal half-up at the third fraction digit, then the one-cent floor.
      const third = parts.fraction.length > 2 ? parts.fraction[2] : '0'
      const rounded = third >= '5' ? truncated + 1n : truncated
      return `-${centsText(rounded < 1n ? 1n : rounded, symbol)}`
    }

    /** One balance row, rendered only in the expanded sidebar. */
    function BalanceAction({ wide, t, getSnapshot, subscribe, refresh }) {
      const state = useStoreValue(subscribe, getSnapshot)
      const [busy, setBusy] = React.useState(false)
      if (!wide || state.status === 'hidden') return null
      const wallets = state.wallets === undefined ? [] : state.wallets
      const failed = state.status === 'failed'
      const empty = failed || wallets.length === 0
      const amount = state.status === 'loading'
        ? '…'
        : empty
          ? '—'
          : wallets.map(wallet => formatAmount(wallet.balance, wallet.currency)).join(' · ')
      const time = state.updatedAt > 0
        ? new Date(state.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : ''
      const bonusWallets = state.bonusWallets === undefined ? [] : state.bonusWallets
      const bonus = bonusWallets
        .filter(wallet => Number(wallet.balance) > 0)
        .map(wallet => formatAmount(wallet.balance, wallet.currency))
        .join(' · ')
      const hint = state.status === 'loading'
        ? t('loading')
        : failed
          ? `${t('unavailable')} · ${t('retry')}`
          : [
            amount,
            t('refresh'),
            time === '' ? '' : t('updated', { time }),
            state.stale === true ? t('stale') : '',
            bonus === '' ? '' : `${t('bonus')} ${bonus}`,
          ].filter(part => part !== '').join(' · ')
      const onClick = () => {
        if (busy || state.status === 'loading') return
        setBusy(true)
        Promise.resolve()
          .then(refresh)
          .catch(() => undefined)
          .finally(() => { setBusy(false) })
      }
      return h(React.Fragment, null,
        h('style', { key: 'style' }, CSS),
        h('button', {
          key: 'row',
          type: 'button',
          className: 'dsh-balance-row',
          'data-account-balance': state.status,
          'data-stale': state.stale === true ? 'true' : undefined,
          'data-busy': busy ? 'true' : undefined,
          title: hint,
          'aria-label': failed ? t('ariaFailed') : t('aria', { amount }),
          'aria-busy': busy || state.status === 'loading' ? 'true' : undefined,
          onClick,
        },
          h('span', { className: 'dsh-balance-label' }, t('label')),
          h('span', {
            className: 'dsh-balance-value',
            'data-empty': empty ? 'true' : undefined,
          }, amount),
        ),
      )
    }

    const CSS = `
      .dsh-balance-row {
        display: flex;
        flex: 1 1 auto;
        align-items: center;
        gap: 8px;
        min-width: 0;
        height: 32px;
        margin: 6px 2px 0;
        padding: 0 calc(var(--dsh-sidebar-row-padding, 12px) - var(--dsh-sidebar-paint-inset, 3px));
        border: 0;
        border-inline: var(--dsh-sidebar-paint-inset, 3px) solid transparent;
        border-radius: var(--dsw-radius-md);
        background: transparent;
        background-clip: padding-box;
        color: var(--dsw-alias-label-secondary);
        font: inherit;
        font-size: 12px;
        line-height: 18px;
        text-align: left;
        cursor: pointer;
        box-sizing: border-box;
      }
      @media (hover: hover) {
        .dsh-balance-row:hover { background-color: var(--dsw-alias-interactive-bg-hover); }
      }
      .dsh-balance-row:focus-visible {
        outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
        outline-offset: -2px;
      }
      .dsh-balance-row[data-busy='true'] .dsh-balance-value { opacity: 0.55; }
      .dsh-balance-label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dsh-balance-value {
        flex: 0 1 auto;
        min-width: 0;
        margin-left: auto;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--dsw-alias-label-primary);
        font-size: 13px;
        font-weight: 500;
        font-variant-numeric: tabular-nums;
      }
      .dsh-balance-value[data-empty='true'] {
        color: var(--dsw-alias-label-tertiary);
        font-weight: 400;
      }
      .dsh-balance-row[data-stale='true'] .dsh-balance-value {
        color: var(--dsw-alias-label-tertiary);
      }
    `

    /** The empty, signed-out snapshot; the row renders nothing for it. */
    const HIDDEN = { status: 'hidden', wallets: [], bonusWallets: [], updatedAt: 0, stale: false }

    return {
      inject: ['slots', 'locale', 'remote', 'remote.account', 'accountUi'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NAMESPACE, { en, zh }), 'account-balance: dictionaries')

        let snapshot = HIDDEN
        const listeners = new Set()
        const publish = (next) => {
          if (next.status === snapshot.status
            && next.wallets === snapshot.wallets
            && next.bonusWallets === snapshot.bonusWallets
            && next.updatedAt === snapshot.updatedAt
            && next.stale === snapshot.stale) return
          snapshot = next
          for (const listener of listeners) listener()
        }
        const subscribe = (listener) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        }
        const getSnapshot = () => snapshot
        const signedIn = () => {
          const state = ctx.accountUi.getSnapshot()
          return state.view !== undefined && state.view.status === 'credential-stored'
        }

        // A read that outlived a credential or connection change never publishes:
        // its generation no longer matches, and the newer read owns the row.
        let revision = 0
        let inflight = null
        let lastAttemptAt = 0
        const read = () => {
          if (inflight !== null) return inflight
          if (!signedIn()) {
            publish(HIDDEN)
            return Promise.resolve()
          }
          const generation = revision
          lastAttemptAt = Date.now()
          if (snapshot.status !== 'ready') publish({ ...snapshot, status: 'loading', stale: false })
          const task = (async () => {
            try {
              const result = await ctx.remote.account.getBalance(
                ctx.accountUi.clientMetadata(ctx.locale.getSnapshot().active),
              )
              if (generation !== revision) return
              if (!result.ok) throw new Error('account balance request refused')
              const value = result.value
              // A null projection carries no balance for this attempt; the row
              // keeps its last value rather than inventing an empty wallet.
              if (value === null) throw new Error('account balance unavailable')
              if (value.status === 'failed') throw new Error('account balance read failed')
              publish({
                status: 'ready',
                wallets: value.value,
                bonusWallets: value.bonusWallets,
                updatedAt: Date.now(),
                stale: false,
              })
            } catch (_error) {
              if (generation !== revision) return
              const hadValue = snapshot.updatedAt > 0
              publish({ ...snapshot, status: hadValue ? 'ready' : 'failed', stale: hadValue })
            }
          })()
          inflight = task
          void task.finally(() => { if (inflight === task) inflight = null })
          return task
        }

        /**
         * Adopt one account-stream state. `reset` marks a changed account
         * availability, credential, or connection lifetime, so the previous
         * amount must not outlive it; a plain frame keeps the value and only
         * re-reads it.
         */
        const adopt = (state, reset) => {
          const view = state === undefined ? undefined : state.view
          if (view === undefined || view.status !== 'credential-stored') {
            if (snapshot.status !== 'hidden') {
              revision++
              inflight = null
              publish(HIDDEN)
            }
            return
          }
          if (reset === true) {
            revision++
            inflight = null
            // A carrier failure also resets the stream; that one keeps the last
            // amount, marked stale by the failed read instead of blanking.
            if (state.failed !== true) {
              publish({ status: 'loading', wallets: [], bonusWallets: [], updatedAt: 0, stale: false })
            }
          }
          void read()
        }

        ctx.on('account-ui/change', (state, reset) => { adopt(state, reset) })
        ctx.on('account-ui/refresh', () => read())
        adopt(ctx.accountUi.getSnapshot(), true)

        // A balance drifts as the account is used, so an idle page re-reads on a
        // slow interval and once more when the window regains focus.
        ctx.effect(() => {
          const maybeRefresh = () => {
            if (document.visibilityState !== 'visible') return
            if (!signedIn()) return
            if (Date.now() - lastAttemptAt < MIN_ATTEMPT_GAP_MS) return
            void read()
          }
          const timer = window.setInterval(maybeRefresh, REFRESH_INTERVAL_MS)
          document.addEventListener('visibilitychange', maybeRefresh)
          window.addEventListener('focus', maybeRefresh)
          return () => {
            window.clearInterval(timer)
            document.removeEventListener('visibilitychange', maybeRefresh)
            window.removeEventListener('focus', maybeRefresh)
          }
        }, 'account-balance: refresh cadence')

        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'account-balance',
          order: 100,
          locale: NAMESPACE,
          inject: () => ({ getSnapshot, subscribe, refresh: read }),
        }, BalanceAction))
      },
    }
  },
})
