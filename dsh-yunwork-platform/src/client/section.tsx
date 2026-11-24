/**
 * The 云大师 account & balance page in the official Settings dialog, 1:1 aligned with uwork's 3-card layout.
 *
 * Uses `@deepseek-ai/dsh-client-ui-primitives` components (`Button`, icons) and `--dsw-*` CSS variables;
 * no bare HTML `<button>` elements.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  Button, IconRefreshOutlineRegular, IconRightUpOutlineRegular, IconUserOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  isSignInInFlight, YUNWORK_ROUTES, type YunworkBalanceView, type YunworkConversationMessage,
  type YunworkConversationsPage, type YunworkConversationSummary, type YunworkProblem,
  type YunworkProblemCode, type YunworkReply, type YunworkState, type YunworkUsageLogItem,
  type YunworkUsageLogsPage,
} from '../shared.ts'

const syncListeners = new Set<() => void>()

export function subscribeYunworkSync (listener: () => void): () => void {
  syncListeners.add(listener)
  return () => { syncListeners.delete(listener) }
}

export function notifyYunworkSync (): void {
  for (const listener of syncListeners) listener()
}

export function formatCurrency (raw: string | undefined, symbol = '¥'): string {
  if (raw === undefined) return `${symbol}--`
  const num = Number(raw)
  if (!Number.isFinite(num) || Math.abs(num) < 1e-12) return `${symbol}0.00`
  if (num > 0 && num < 0.01) return `<${symbol}0.01`
  const fixed = Math.abs(Math.floor(num * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return num < 0 ? `-${symbol}${fixed}` : `${symbol}${fixed}`
}

export function formatPointsDisplay (raw: string | undefined): string {
  if (raw === undefined) return '--'
  const num = Number(raw)
  if (!Number.isFinite(num) || Math.abs(num) < 1e-12) return '0'
  if (num > 0 && num < 0.01) return '<0.01'
  return (Math.floor(num * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

/** Linear user icon for `settings.section.icon`. */
export function YunworkUserIcon ({ size = 16 }: { readonly size?: number }) {
  return <IconUserOutlineMedium size={size} />
}

/** Call a Host route of the account: GET without a body, POST with one. */
export async function callHost<T = unknown> (path: string, body?: object): Promise<YunworkReply<T>> {
  let response: Response
  try {
    response = await fetch(path, body === undefined
      ? { cache: 'no-store' }
      : { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  } catch (error) {
    console.error('[yunwork-platform] callHost transport error:', path, error)
    return { error: { code: 'network', detail: error instanceof Error ? error.message : String(error) } }
  }
  const text = await response.text()
  try {
    return JSON.parse(text) as YunworkReply<T>
  } catch {
    console.error('[yunwork-platform] callHost non-JSON response:', path, response.status, text.slice(0, 200))
    return { error: { code: 'failed', detail: `HTTP ${response.status}` } }
  }
}

type ProblemKey = 'pNetwork' | 'pServer' | 'pRejected' | 'pSessionEnded' | 'pDenied' | 'pCancelled'
  | 'pExpired' | 'pBusy' | 'pNoModels' | 'pNoCatalog' | 'pNotConfigured' | 'pFailed'

const PROBLEM_KEYS: Readonly<Record<YunworkProblemCode, ProblemKey>> = {
  network: 'pNetwork',
  server: 'pServer',
  rejected: 'pRejected',
  'session-ended': 'pSessionEnded',
  denied: 'pDenied',
  cancelled: 'pCancelled',
  expired: 'pExpired',
  busy: 'pBusy',
  'no-models': 'pNoModels',
  'no-catalog': 'pNoCatalog',
  'not-configured': 'pNotConfigured',
  failed: 'pFailed',
}

const PAGE_SIZE = 5
const MAX_OFFSET = 9_999

const STACK = { display: 'grid', gap: '12px' }
const CARD = {
  display: 'grid',
  gap: '12px',
  padding: '16px',
  borderRadius: 'var(--dsw-radius-lg, 12px)',
  border: '1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08))',
  background: 'var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, #fff))',
  fontSize: '14px',
  lineHeight: 1.5,
}
const DIVIDER = { height: '1px', background: 'var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08))' }
const ROW_BETWEEN = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' as const }
const MUTED = { color: 'var(--dsw-alias-label-secondary, #666)', fontSize: '13px' }
const ERROR_TEXT = { color: 'var(--dsw-alias-state-danger-primary, #c0392b)', fontSize: '13px' }

function formatInt (value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
}

function formatDecimal (value: number, maxFractionDigits: number): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: maxFractionDigits }).format(value)
}

function formatTimestamp (unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000)
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} `
    + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function formatUsageQuota (item: YunworkUsageLogItem): string {
  if (item.consumption !== undefined) {
    if (item.consumption.subscriptionPoints > 0) {
      const unit = item.consumption.subscriptionUnit === 'points' ? '积分' : item.consumption.subscriptionUnit
      return `${formatDecimal(item.consumption.subscriptionPoints, 6)} ${unit}`
    }
    if (item.consumption.walletAmount > 0) {
      const digits = Math.abs(item.consumption.walletAmount) >= 1 ? 4 : 6
      const formatted = formatDecimal(item.consumption.walletAmount, digits)
      return item.consumption.walletSymbol !== '' ? `${item.consumption.walletSymbol}${formatted}` : formatted
    }
    return '0'
  }
  if (item.subscriptionQuota > 0 && item.quota > 0) return `${formatInt(item.subscriptionQuota)} + ${formatInt(item.quota)}`
  if (item.subscriptionQuota > 0) return formatInt(item.subscriptionQuota)
  if (item.quota > 0) return formatInt(item.quota)
  return '0'
}

function formatRequestLabel (item: YunworkUsageLogItem): string {
  if (item.userInput !== undefined && item.userInput.length > 0) {
    return item.userInputTruncated === true ? `${item.userInput}…` : item.userInput
  }
  return `${formatInt(item.promptTokens)} + ${formatInt(item.completionTokens)} tokens`
}

function formatIsoTime (iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function extractMessageText (payload: Record<string, unknown>): string {
  const versions = payload.versions
  if (Array.isArray(versions) && versions.length > 0) {
    const last: unknown = versions[versions.length - 1]
    if (typeof last === 'object' && last !== null && 'content' in last) {
      const content = (last as Record<string, unknown>).content
      if (typeof content === 'string') return content
    }
  }
  if (typeof payload.content === 'string') return payload.content
  return JSON.stringify(payload)
}

export function YunworkAccountSection ({ t }: PropsLocale<'yunwork'>) {
  const [state, setState] = useState<YunworkState | undefined>(undefined)
  const [balance, setBalance] = useState<YunworkBalanceView | undefined>(undefined)
  const [balanceError, setBalanceError] = useState<YunworkProblem | undefined>(undefined)
  const [logsPage, setLogsPage] = useState(1)
  const [logsNonce, setLogsNonce] = useState(0)
  const [logs, setLogs] = useState<YunworkUsageLogsPage | undefined>(undefined)
  const [logsLoading, setLogsLoading] = useState(false)
  const [logsError, setLogsError] = useState<YunworkProblem | undefined>(undefined)
  const [convsNonce, setConvsNonce] = useState(0)
  const [convs, setConvs] = useState<YunworkConversationsPage | undefined>(undefined)
  const [convsLoading, setConvsLoading] = useState(false)
  const [selectedConv, setSelectedConv] = useState<YunworkConversationSummary | undefined>(undefined)
  const [convMsgs, setConvMsgs] = useState<readonly YunworkConversationMessage[] | undefined>(undefined)
  const [convMsgsLoading, setConvMsgsLoading] = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const [problem, setProblem] = useState<YunworkProblem | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const apply = useCallback((reply: YunworkReply) => {
    if (reply.state !== undefined) setState(reply.state)
    setProblem(reply.error)
  }, [])

  const load = useCallback(async () => {
    try {
      apply(await callHost(YUNWORK_ROUTES.state))
    } catch {
      setProblem({ code: 'network' })
    }
  }, [apply])

  const loadBalance = useCallback(async () => {
    const reply = await callHost<YunworkBalanceView>(YUNWORK_ROUTES.balance)
    if (reply.result !== undefined) {
      setBalance(reply.result)
      setBalanceError(undefined)
    } else if (reply.error !== undefined) {
      setBalanceError(reply.error)
    }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => subscribeYunworkSync(() => { void load() }), [load])

  const signedIn = state?.account !== undefined
  useEffect(() => {
    if (!signedIn) {
      setBalance(undefined)
      setLogs(undefined)
      return
    }
    void loadBalance()
  }, [signedIn, loadBalance])

  useEffect(() => {
    if (!signedIn) return
    let cancelled = false
    setLogsLoading(true)
    setLogsError(undefined)
    void callHost<YunworkUsageLogsPage>(`${YUNWORK_ROUTES.usageLogs}?page=${logsPage}&pageSize=${PAGE_SIZE}`).then((reply) => {
      if (cancelled) return
      if (reply.result !== undefined) {
        setLogs(reply.result)
      } else {
        setLogsError(reply.error ?? { code: 'failed' })
      }
    }, () => {
      if (!cancelled) setLogsError({ code: 'network' })
    }).finally(() => {
      if (!cancelled) setLogsLoading(false)
    })
    return () => { cancelled = true }
  }, [signedIn, logsPage, logsNonce])

  useEffect(() => {
    if (!signedIn) { setConvs(undefined); setSelectedConv(undefined); return }
    let cancelled = false
    setConvsLoading(true)
    void callHost<YunworkConversationsPage>(`${YUNWORK_ROUTES.conversations}?offset=0&limit=30`).then((reply) => {
      if (!cancelled && reply.result !== undefined) setConvs(reply.result)
    }).finally(() => { if (!cancelled) setConvsLoading(false) })
    return () => { cancelled = true }
  }, [signedIn, convsNonce])

  useEffect(() => {
    if (selectedConv === undefined) { setConvMsgs(undefined); return }
    let cancelled = false
    setConvMsgsLoading(true)
    void callHost<{ items: readonly YunworkConversationMessage[] }>(`${YUNWORK_ROUTES.conversationMessages}?id=${encodeURIComponent(selectedConv.id)}&limit=50`).then((reply) => {
      if (!cancelled && reply.result !== undefined) setConvMsgs(reply.result.items)
    }).finally(() => { if (!cancelled) setConvMsgsLoading(false) })
    return () => { cancelled = true }
  }, [selectedConv])

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
    } catch {
      setProblem({ code: 'network' })
    } finally {
      setBusy(false)
    }
  }, [apply])

  const account = state?.account
  const waiting = state?.signIn.phase === 'waiting-browser'
  const authorizeUrl = state?.signIn.authorizeUrl
  const shown = problem ?? state?.signIn.error ?? state?.models.error ?? state?.notice
  const walletHref = state?.authBaseUrl ? new URL('/wallet', state.authBaseUrl).href : undefined
  const usageHref = state?.authBaseUrl ? new URL('/usage-logs', state.authBaseUrl).href : undefined
  const maxPage = logs !== undefined
    ? Math.max(1, Math.min(Math.ceil(logs.total / logs.pageSize), Math.floor(MAX_OFFSET / logs.pageSize) + 1))
    : 1

  if (account === undefined) {
    return (
      <div style={STACK}>
        <div style={CARD}>
          <div style={ROW_BETWEEN}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ width: '40px', height: '40px', borderRadius: '999px', background: 'var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06))', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <IconUserOutlineMedium size={20} />
              </span>
              <div style={{ display: 'grid', gap: '2px' }}>
                <strong>{t('notSignedIn')}</strong>
                <span style={MUTED}>登录云大师账号以使用模型与查看余额</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Button variant="primary" size="sm" disabled={busy} onClick={() => { void act(YUNWORK_ROUTES.signIn) }}>
                {t('signIn')}
              </Button>
              {waiting && state?.signIn.attemptId !== undefined ? (
                <Button size="sm" disabled={busy} onClick={() => { void act(YUNWORK_ROUTES.cancel, { id: state.signIn.attemptId }) }}>
                  {t('cancel')}
                </Button>
              ) : null}
            </div>
          </div>
          {waiting ? (
            <div style={ROW_BETWEEN}>
              <span style={MUTED}>{t('waiting')}</span>
              {authorizeUrl !== undefined ? (
                <a href={authorizeUrl} target="_blank" rel="noreferrer" style={{ ...MUTED, color: 'inherit', textDecoration: 'underline' }}>{t('openPage')}</a>
              ) : null}
            </div>
          ) : null}
          {shown !== undefined ? (
            <div style={ERROR_TEXT}>
              {t(PROBLEM_KEYS[shown.code])}
              {shown.detail !== undefined ? ` (${shown.detail})` : ''}
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div style={STACK}>
      {/* Card 1: 账号信息 */}
      <div style={CARD}>
        <div style={ROW_BETWEEN}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
            <span style={{ width: '40px', height: '40px', borderRadius: '999px', background: 'var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06))', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <IconUserOutlineMedium size={20} />
            </span>
            <div style={{ display: 'grid', gap: '2px', minWidth: 0 }}>
              <strong style={{ fontSize: '15px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{account.displayName}</strong>
              <span style={MUTED}>{account.username}</span>
            </div>
          </div>
          {walletHref !== undefined ? (
            <a
              href={walletHref}
              target="_blank"
              rel="noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '13px', color: 'var(--dsw-alias-label-secondary, #666)', textDecoration: 'none' }}
            >
              <span>更多账号信息</span>
              <IconRightUpOutlineRegular size={14} />
            </a>
          ) : null}
        </div>
        <div style={DIVIDER} />
        <div style={ROW_BETWEEN}>
          <span style={MUTED}>
            {t('modelsCount').replace('{count}', String(state?.models.count ?? 0))}
            {state?.models.custom ? ` ${t('modelsCustom')}` : ''}
          </span>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Button size="sm" disabled={busy} onClick={() => { void act(YUNWORK_ROUTES.refresh) }}>
              {t('refresh')}
            </Button>
            <Button size="sm" disabled={busy} onClick={() => { setConfirmSignOut(true) }}>
              {t('signOut')}
            </Button>
          </div>
        </div>
        {shown !== undefined ? (
          <div style={ERROR_TEXT}>
            {t(PROBLEM_KEYS[shown.code])}
            {shown.detail !== undefined ? ` (${shown.detail})` : ''}
          </div>
        ) : null}
      </div>

      {/* Card 2: 余额与积分 */}
      <div style={CARD}>
        <div style={ROW_BETWEEN}>
          <span style={MUTED}>充值余额</span>
          <strong style={{ fontSize: '15px' }}>
            {balance !== undefined ? formatCurrency(balance.walletBalance) : (balanceError !== undefined ? '暂不可用' : '加载中…')}
          </strong>
        </div>
        <div style={DIVIDER} />
        <div style={ROW_BETWEEN}>
          <span style={MUTED}>订阅积分</span>
          <strong style={{ fontSize: '15px' }}>
            {balance === undefined
              ? (balanceError !== undefined ? '暂不可用' : '加载中…')
              : !balance.hasSubscription
                ? '暂无订阅'
                : balance.unlimited === true
                  ? '无限'
                  : `${formatPointsDisplay(balance.remainingPoints)} / ${formatPointsDisplay(balance.totalPoints)}`}
          </strong>
        </div>
        <div style={DIVIDER} />
        <div style={ROW_BETWEEN}>
          <span style={MUTED}>更多</span>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Button
              size="sm"
              disabled={usageHref === undefined}
              onClick={() => {
                if (usageHref === undefined) return
                window.open(usageHref, '_blank', 'noreferrer')
                window.addEventListener('focus', () => { void loadBalance() }, { once: true })
              }}
            >
              查询用量
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={walletHref === undefined}
              onClick={() => {
                if (walletHref === undefined) return
                window.open(walletHref, '_blank', 'noreferrer')
                window.addEventListener('focus', () => { void loadBalance() }, { once: true })
              }}
            >
              充值
            </Button>
          </div>
        </div>
      </div>

      {/* Card 3: 消耗明细 */}
      <div style={CARD}>
        <div style={ROW_BETWEEN}>
          <strong style={{ fontSize: '14px' }}>消耗明细</strong>
          <Button
            variant="ghost"
            size="sm"
            disabled={logsLoading}
            aria-label="刷新消耗明细"
            onClick={() => { setLogsNonce(n => n + 1) }}
          >
            <IconRefreshOutlineRegular size={14} />
          </Button>
        </div>

        {logsLoading ? (
          <div style={MUTED}>加载中…</div>
        ) : logsError !== undefined ? (
          <div style={ROW_BETWEEN}>
            <span style={ERROR_TEXT}>{t(PROBLEM_KEYS[logsError.code])}</span>
            <Button size="sm" onClick={() => { setLogsNonce(n => n + 1) }}>重试</Button>
          </div>
        ) : logs === undefined || logs.items.length === 0 ? (
          <div style={MUTED}>暂无消耗记录</div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 110px 140px', gap: '8px 16px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #666)', paddingBottom: '6px', borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08))' }}>
              <span>请求与时间</span>
              <span style={{ textAlign: 'right' }}>消耗</span>
              <span style={{ textAlign: 'right' }}>模型</span>
            </div>
            <div style={{ display: 'grid', gap: '10px' }}>
              {logs.items.map(item => (
                <div key={item.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 110px 140px', gap: '8px 16px', alignItems: 'center', fontSize: '13px' }}>
                  <div style={{ display: 'grid', gap: '2px', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.userInput}>
                        {formatRequestLabel(item)}
                      </span>
                      {item.useTime > 0 ? <span style={{ ...MUTED, fontSize: '12px', flexShrink: 0 }}>{item.useTime}s</span> : null}
                    </div>
                    <span style={{ ...MUTED, fontSize: '12px' }}>{formatTimestamp(item.createdAt)}</span>
                  </div>
                  <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{formatUsageQuota(item)}</span>
                  <span style={{ textAlign: 'right', ...MUTED, maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.modelName}>
                    {item.modelName}
                  </span>
                </div>
              ))}
            </div>
            {logs.total > logs.pageSize ? (
              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px', paddingTop: '6px' }}>
                <Button size="sm" disabled={logsPage <= 1} onClick={() => { setLogsPage(p => Math.max(1, p - 1)) }}>
                  上一页
                </Button>
                <span style={MUTED}>{`${logs.page} / ${maxPage}`}</span>
                <Button size="sm" disabled={logsPage >= maxPage} onClick={() => { setLogsPage(p => Math.min(maxPage, p + 1)) }}>
                  下一页
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* Card 4: 云端会话记录 */}
      <div style={CARD}>
        <div style={ROW_BETWEEN}>
          <strong style={{ fontSize: '14px' }}>
            {selectedConv !== undefined ? selectedConv.title || selectedConv.id : '云端会话记录'}
          </strong>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {selectedConv !== undefined ? (
              <Button size="sm" onClick={() => { setSelectedConv(undefined) }}>返回列表</Button>
            ) : (
              <Button variant="ghost" size="sm" disabled={convsLoading} aria-label="刷新云端会话" onClick={() => { setConvsNonce(n => n + 1) }}>
                <IconRefreshOutlineRegular size={14} />
              </Button>
            )}
          </div>
        </div>

        {selectedConv !== undefined ? (
          convMsgsLoading ? <div style={MUTED}>加载中…</div>
            : convMsgs === undefined || convMsgs.length === 0 ? <div style={MUTED}>暂无消息</div>
              : (
                <div style={{ display: 'grid', gap: '8px', maxHeight: '280px', overflow: 'auto' }}>
                  {convMsgs.map(msg => (
                    <div key={msg.id} style={{ padding: '8px 10px', borderRadius: '6px', background: 'var(--dsw-alias-bg-base, rgba(0,0,0,0.02))', border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.06))', fontSize: '13px' }}>
                      <div style={{ ...MUTED, fontSize: '11px', marginBottom: '2px' }}>{`#${msg.sequence} · ${formatIsoTime(msg.createdAt)}`}</div>
                      <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{extractMessageText(msg.payload)}</div>
                    </div>
                  ))}
                </div>
              )
        ) : convsLoading ? <div style={MUTED}>加载中…</div>
          : convs === undefined || convs.items.length === 0 ? <div style={MUTED}>暂无云端会话记录</div>
            : (
              <div style={{ display: 'grid', gap: '6px' }}>
                {convs.items.map(item => (
                  <div
                    key={item.id}
                    onClick={() => { setSelectedConv(item) }}
                    style={{ ...ROW_BETWEEN, padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.06))', cursor: 'pointer' }}
                  >
                    <span style={{ fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title || item.id}</span>
                    <span style={{ ...MUTED, fontSize: '12px', flexShrink: 0 }}>{formatIsoTime(item.updateTime)}</span>
                  </div>
                ))}
              </div>
            )}
      </div>

      {confirmSignOut ? (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
          <div style={{ ...CARD, width: '320px', maxWidth: '90vw' }}>
            <strong style={{ fontSize: '15px' }}>确认退出登录？</strong>
            <span style={MUTED}>退出后将清除本地登录凭证，需要重新登录才能使用云大师模型。</span>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <Button size="sm" onClick={() => { setConfirmSignOut(false) }}>取消</Button>
              <Button variant="primary" size="sm" disabled={busy} onClick={() => { setConfirmSignOut(false); void act(YUNWORK_ROUTES.signOut) }}>确认退出</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
