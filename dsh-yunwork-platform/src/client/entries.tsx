/**
 * The account page beyond Settings: a main-column panel opened from the sidebar's panel list, and the
 * `settings.launcher` occupant at the sidebar foot matching `uwork`'s AccountMenu & AccountMenuHeader.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import {
  IconCheckOutlineRegular, IconCopyOutlineRegular, IconEllipsisOutlineMedium,
  IconRefreshOutlineRegular, IconSettingsOutlineMedium, IconUserOutlineMedium, Menu, ShortcutKeys,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { isSignInInFlight, YUNWORK_ROUTES, type YunworkBalanceView, type YunworkProblem, type YunworkReply, type YunworkState } from '../shared.ts'
import { BrandFrame, BrandMark, BrandName, HeroMark } from './Brand.tsx'
import { LogoutIcon } from './LogoutIcon.tsx'
import { callHost, formatCurrency, formatPointsDisplay, notifyYunworkSync, subscribeYunworkSync, YunworkAccountSection } from './section.tsx'

/** The account page's main-column panel and its sidebar row resolve to this id. */
export const YUNWORK_PANEL_ID = 'yunwork-platform' as MainPanelId

/** The account page in the main column, framed like the official entry pages. */
function YunworkAccountPanel ({ t }: PropsLocale<'yunwork'>) {
  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '1.25rem' }}>
      <div style={{ maxWidth: '42rem', margin: '0 auto', display: 'grid', gap: '0.75rem' }}>
        <strong style={{ fontSize: '1rem' }}>{t('title')}</strong>
        <YunworkAccountSection t={t} />
      </div>
    </div>
  )
}

/**
 * The `settings.launcher` occupant: replaces the standalone Settings row at the sidebar foot with the upstream
 * `… 更多` / signed-in account menu.
 */
function YunworkSettingsLauncher ({ wide, settingsShortcut, openSettings, t }: PropsRuntime<'settings.launcher'> & PropsLocale<'yunwork'>) {
  const [state, setState] = useState<YunworkState | undefined>(undefined)
  const [balance, setBalance] = useState<YunworkBalanceView | undefined>(undefined)
  const [problem, setProblem] = useState<YunworkProblem | undefined>(undefined)
  const [openMenu, setOpenMenu] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [copied, setCopied] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const apply = useCallback((reply: YunworkReply) => {
    if (reply.state !== undefined) setState(reply.state)
    setProblem(reply.error)
  }, [])

  const load = useCallback(async () => {
    apply(await callHost(YUNWORK_ROUTES.state))
  }, [apply])

  const loadBalance = useCallback(async () => {
    setRefreshing(true)
    try {
      const reply = await callHost<YunworkBalanceView>(YUNWORK_ROUTES.balance)
      if (reply.result !== undefined) setBalance(reply.result)
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { void load() }, [load, wide])
  useEffect(() => subscribeYunworkSync(() => { void load() }), [load])

  const signedIn = state?.account !== undefined
  useEffect(() => {
    if (!signedIn) {
      setBalance(undefined)
      return
    }
    void loadBalance()
  }, [signedIn, loadBalance])

  useEffect(() => {
    if (openMenu && signedIn) void loadBalance()
  }, [openMenu, signedIn, loadBalance])

  const phase = state?.signIn.phase
  useEffect(() => {
    if (phase === undefined || !isSignInInFlight(phase)) return
    const refresh = (): void => { void load() }
    const timer = setInterval(refresh, 1500)
    window.addEventListener('focus', refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [phase, load])

  const act = useCallback(async (path: string, body: object = {}) => {
    setBusy(true)
    try {
      apply(await callHost(path, body))
      notifyYunworkSync()
    } finally {
      setBusy(false)
    }
  }, [apply])

  const account = state?.account
  const waiting = phase === 'waiting-browser'
  const inFlight = phase !== undefined && isSignInInFlight(phase)
  const authorizeUrl = state?.signIn.authorizeUrl
  const shownError = problem ?? state?.signIn.error
  const label = account !== undefined && account.displayName !== '' ? account.displayName : '更多'

  const header = (account !== undefined || inFlight || shownError !== undefined) ? (
    <div className="yw-headerRoot">
      {account !== undefined ? (
        <>
          <div className="yw-profileCard">
            <div className="yw-identity">
              <span className="yw-avatarLg">
                <IconUserOutlineMedium size={18} />
              </span>
              <div className="yw-identityCopy">
                <span className="yw-name">{account.displayName}</span>
                {account.username !== '' && account.username !== account.displayName ? (
                  <span className="yw-handle">{account.username}</span>
                ) : null}
              </div>
            </div>
            <div className="yw-iconActions">
              <button
                type="button"
                className="yw-iconButton"
                aria-label={copied ? '已复制' : '复制用户名'}
                onClick={() => { void navigator.clipboard?.writeText(account.username); setCopied(true); setTimeout(() => { setCopied(false) }, 1500) }}
              >
                {copied ? <IconCheckOutlineRegular size={16} /> : <IconCopyOutlineRegular size={16} />}
              </button>
              <button
                type="button"
                className="yw-iconButton"
                aria-label="刷新余额"
                disabled={refreshing}
                onClick={() => { void loadBalance() }}
              >
                <IconRefreshOutlineRegular size={16} />
              </button>
            </div>
          </div>

          <div className="yw-balanceCard">
            <div className="yw-metrics">
              <div className="yw-metric">
                <span className="yw-metricLabel">钱包余额</span>
                <span className="yw-metricValue">{formatCurrency(balance?.walletBalance)}</span>
              </div>
              <div className="yw-metric">
                <span className="yw-metricLabel">订阅积分</span>
                <span className="yw-metricValue">
                  {balance === undefined ? '--' : balance.unlimited === true ? '无限' : formatPointsDisplay(balance.remainingPoints)}
                </span>
                <span className="yw-metricSub">
                  {balance === undefined ? '--' : balance.unlimited === true ? '不限额度' : `${formatPointsDisplay(balance.remainingPoints)} / ${formatPointsDisplay(balance.totalPoints)}`}
                </span>
              </div>
            </div>
            <div className="yw-ctaRow">
              <button
                type="button"
                className="yw-ctaButton yw-ctaPrimary"
                onClick={() => { if (state?.authBaseUrl !== undefined) window.open(new URL('/wallet', state.authBaseUrl).href, '_blank', 'noreferrer') }}
              >
                充值
              </button>
              <button
                type="button"
                className="yw-ctaButton"
                onClick={() => { setOpenMenu(false); if (state?.authBaseUrl !== undefined) window.open(new URL('/usage-logs', state.authBaseUrl).href, '_blank', 'noreferrer') }}
              >
                查询用量
              </button>
            </div>
          </div>
        </>
      ) : null}

      {inFlight ? (
        <div style={{ padding: '4px 6px', display: 'grid', gap: '4px', fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #666)' }}>
          <span>{t('waiting')}</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            {waiting && authorizeUrl !== undefined ? (
              <button type="button" disabled={busy} onClick={() => { void act(YUNWORK_ROUTES.signIn) }} style={{ border: 'none', background: 'transparent', color: 'inherit', textDecoration: 'underline', cursor: 'pointer', padding: 0, fontSize: '12px' }}>
                重新打开授权页
              </button>
            ) : null}
            {waiting && state?.signIn.attemptId !== undefined ? (
              <button type="button" disabled={busy} onClick={() => { void act(YUNWORK_ROUTES.cancel, { id: state.signIn.attemptId }) }} style={{ border: 'none', background: 'transparent', color: 'inherit', textDecoration: 'underline', cursor: 'pointer', padding: 0, fontSize: '12px' }}>
                {t('cancel')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {shownError !== undefined ? (
        <div style={{ padding: '4px 6px', fontSize: '12px', color: 'var(--dsw-alias-state-danger-primary, #c0392b)' }}>
          {shownError.detail ?? shownError.code}
        </div>
      ) : null}
    </div>
  ) : undefined

  const anchor = (
    <button
      ref={triggerRef}
      type="button"
      className="yw-trigger"
      data-collapsed={!wide}
      data-signed-out={account === undefined}
      onClick={() => { setOpenMenu(prev => !prev) }}
      aria-label={account !== undefined ? t('title') : '更多'}
      aria-haspopup="menu"
      aria-expanded={openMenu}
    >
      {account !== undefined ? (
        <span className="yw-avatar">
          <IconUserOutlineMedium size={14} />
        </span>
      ) : (
        <IconEllipsisOutlineMedium size={14} />
      )}
      {wide ? <span className="yw-label">{label}</span> : null}
    </button>
  )

  if (account !== undefined) {
    return (
      <Menu
        open={openMenu}
        side="top"
        portal
        autoFocus
        className="yw-anchor"
        listClassName="yw-signedInMenu"
        anchor={anchor}
        onClose={() => { setOpenMenu(false) }}
      >
        {header}
        <div className="yw-menuDivider" />
        <div className="yw-menuList">
          <button
            type="button"
            role="menuitem"
            className="yw-menuItem"
            onClick={() => { setOpenMenu(false); triggerRef.current?.focus(); openSettings() }}
          >
            <span className="yw-menuItemLeading">
              <IconSettingsOutlineMedium size={16} />
              <span>设置</span>
            </span>
            {settingsShortcut !== undefined ? <ShortcutKeys keys={settingsShortcut.keys} /> : null}
          </button>
          <button
            type="button"
            role="menuitem"
            className="yw-menuItem"
            disabled={busy}
            onClick={() => { setOpenMenu(false); void act(YUNWORK_ROUTES.signOut) }}
          >
            <span className="yw-menuItemLeading">
              <LogoutIcon />
              <span>{t('signOut')}</span>
            </span>
          </button>
        </div>
      </Menu>
    )
  }

  return (
    <Menu
      open={openMenu}
      side="top"
      portal
      autoFocus
      className="yw-anchor"
      listClassName="yw-signedOutMenu"
      anchor={anchor}
      items={[
        {
          id: 'settings',
          label: '设置',
          icon: <IconSettingsOutlineMedium size={16} />,
          ...(settingsShortcut === undefined ? {} : { shortcut: settingsShortcut }),
        },
        { id: 'signin', label: t('signIn'), icon: <IconUserOutlineMedium size={16} />, disabled: busy },
      ]}
      onClose={() => { setOpenMenu(false) }}
      onSelect={(id) => {
        if (id === 'settings') {
          setOpenMenu(false)
          triggerRef.current?.focus()
          openSettings()
        } else if (id === 'signin') {
          void act(YUNWORK_ROUTES.signIn)
        }
      }}
    >
      {header}
    </Menu>
  )
}

/**
 * Register the account's entries: the main-column panel, its sidebar row and the `settings.launcher` menu.
 * @param ctx - the plugin's client context.
 * @param label - the account's name in the sidebar row.
 */
export function registerYunworkEntries (ctx: Context, _opts: { label: () => string }): void {
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: YUNWORK_PANEL_ID, locale: 'yunwork', inject: () => ({}),
  }, YunworkAccountPanel))
  ctx.slots.inject('conversation.hero.frame', () => ctx.slots.register({
    name: 'conversation.hero.frame', id: 'yundashi-brand-frame',
  }, BrandFrame))
  ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({
    name: 'conversation.hero.brand.mark',
  }, HeroMark))
  ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({
    name: 'sidebar.brand.mark',
  }, BrandMark))
  ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({
    name: 'sidebar.brand.name',
  }, BrandName))
  ctx.slots.inject('settings.launcher', () => ctx.slots.register({
    name: 'settings.launcher', locale: 'yunwork', inject: () => ({}),
  }, YunworkSettingsLauncher))
}
