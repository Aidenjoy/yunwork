/**
 * The 云大师 account: sign in to utoken, keep its language key, and let the model route read that key.
 *
 * A sign-in opens utoken's authorize page with PKCE, in the desktop's built-in window where the base serves one and in
 * the system browser otherwise. The code comes back to a one-shot listener on 127.0.0.1, which is the only redirect
 * shape utoken accepts. The Host redeems it, stores the grant, the language key and the profile, and writes the gateway
 * as one `llm-pi-ai` route.
 *
 * There is no refresh token, by design of the server: the access token lasts what `expires_in` says and the language key
 * outlives it, so an expired grant reads as "sign in again" and nothing tries to mint a new one silently.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { credentialKey, credentialRef, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { SettingsForms } from '@deepseek-ai/dsh-settings'
import {
  YUNWORK_API_KEY_REF,
  type YunworkAccountView,
  type YunworkBalanceView,
  type YunworkConversationMessagesPage,
  type YunworkConversationsPage,
  type YunworkProblem,
  type YunworkSignInPhase,
  type YunworkSignInView,
  type YunworkState,
  type YunworkUsageLogsPage,
} from '../shared.ts'
import {
  DESKTOP_CALLBACK_PATH, YunworkApiError, desktopRedirectUri, desktopAuthorizeUrl, exchangeDesktopToken, fetchDesktopBalance, fetchDesktopConversationMessages, fetchDesktopConversations, fetchDesktopUsageLogs, revokeSession, yunworkProblem,
} from './api-client.ts'
import type { YunworkConfig } from './env-config.ts'
import { YunworkModels } from './models.ts'
import type { LocalFiles } from './settings.ts'
import type { YunworkShell } from './shell.ts'

/** The access token and the server that issued it; tokens work on that server alone. */
const GRANT_RECORD = credentialKey('yunwork', 'grant')
/** The account's display fields, so the page can name the user after a restart. */
const PROFILE_RECORD = credentialKey('yunwork', 'profile')
/** The language key, kept beside the credential reference so a reinstall of the route needs no sign-in. */
const SPEECH_RECORD = credentialKey('yunwork', 'speech')

/** The browser part of a sign-in; someone who takes longer than this signs in again. */
const ATTEMPT_TIMEOUT_MS = 10 * 60_000

interface GrantRecord {
  readonly version: 1
  readonly token: string
  readonly issuer: string
  /** ISO time the server said the token stops working; absent on a server that sent no `expires_in`. */
  readonly expiresAt?: string
  readonly connectedAt: string
}

interface ProfileRecord {
  readonly version: 1
  readonly issuer: string
  readonly user: { readonly id: number; readonly username: string; readonly displayName: string; readonly group: string }
}

interface SpeechRecord {
  readonly version: 1
  readonly key: string
  readonly issuer: string
}

function isGrant (value: unknown): value is GrantRecord {
  const record = value as Partial<GrantRecord> | undefined
  return record?.version === 1 && typeof record.token === 'string' && record.token !== '' && typeof record.issuer === 'string'
}

function isProfile (value: unknown): value is ProfileRecord {
  const record = value as Partial<ProfileRecord> | undefined
  return record?.version === 1 && typeof record.issuer === 'string' && typeof record.user?.username === 'string'
}

function isSpeech (value: unknown): value is SpeechRecord {
  const record = value as Partial<SpeechRecord> | undefined
  return record?.version === 1 && typeof record.key === 'string' && record.key !== ''
}

function base64url (bytes: Buffer): string {
  return bytes.toString('base64url')
}

/** What came back to the redirect URI. */
export type CallbackResult = { readonly code: string } | { readonly error: string }

/** The page the browser lands on once the code is redeemed; no script, no external resource. */
const DONE_PAGE = '<!doctype html><meta charset="utf-8"><title>云大师 Agent</title>'
  + '<body style="font-family:system-ui,sans-serif;padding:3rem;line-height:1.6">'
  + '<h1 style="font-size:1.25rem">登录已完成</h1><p>可以关闭这个页面，回到云大师 Agent 继续。</p>'

/**
 * One sign-in's redirect target on 127.0.0.1 (RFC 8252 §7.3): the OS picks the port, the Host header must name it so a
 * rebound name cannot reach it, the state must match, and only the first matching callback counts.
 */
export class LoopbackCallback {
  readonly state = base64url(randomBytes(32))
  readonly verifier = base64url(randomBytes(48))
  readonly challenge = base64url(createHash('sha256').update(this.verifier).digest())
  private server: Server | undefined
  private port = 0
  private used = false

  /** @param received - settles the attempt with what came back; the browser's answer waits for it. */
  constructor (private readonly received: (result: CallbackResult) => Promise<void>) {}

  get redirectUri (): string {
    return desktopRedirectUri(this.port)
  }

  async listen (): Promise<void> {
    const server = createServer((request, response) => { this.handle(request, response) })
    this.server = server
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('loopback listener has no port')
    this.port = address.port
  }

  /** Stop listening; a callback already being answered still gets its answer. */
  close (): void {
    const server = this.server
    if (server === undefined) return
    this.server = undefined
    server.close()
    if (this.used) server.closeIdleConnections()
    else server.closeAllConnections()
  }

  private handle (request: IncomingMessage, response: ServerResponse): void {
    response.setHeader('cache-control', 'no-store')
    response.setHeader('referrer-policy', 'no-referrer')
    response.setHeader('x-content-type-options', 'nosniff')
    if (request.headers.host !== `127.0.0.1:${this.port}`) return this.refuse(response, 403, 'Forbidden')
    if (request.method !== 'GET') return this.refuse(response, 405, 'Method not allowed')
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${this.port}`)
    if (url.pathname !== DESKTOP_CALLBACK_PATH) return this.refuse(response, 404, 'Not found')
    const expected = Buffer.from(this.state)
    const received = Buffer.from(url.searchParams.get('state') ?? '')
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      return this.refuse(response, 400, 'This sign-in link is not for this attempt.')
    }
    if (this.used) return this.finish(response)
    this.used = true
    const code = url.searchParams.get('code')
    const result: CallbackResult = code !== null && code !== ''
      ? { code }
      : { error: url.searchParams.get('error') ?? 'invalid_request' }
    void this.received(result).catch(() => {}).finally(() => { this.finish(response) })
  }

  private finish (response: ServerResponse): void {
    if (!response.writableEnded) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(DONE_PAGE)
    }
    this.close()
  }

  private refuse (response: ServerResponse, status: number, message: string): void {
    response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
    response.end(message)
  }
}

interface Attempt {
  readonly id: string
  phase: YunworkSignInPhase
  authorizeUrl?: string
  error?: YunworkProblem
  readonly controller: AbortController
  callback?: LoopbackCallback
  timer?: NodeJS.Timeout
}

/** Sign-in, the stored grant, the key and the model route; every change runs in order through one queue. */
export class YunworkAccount {
  private attempt: Attempt | undefined
  private queue: Promise<unknown> = Promise.resolve()
  private notice: YunworkProblem | undefined
  private readonly lifetime = new AbortController()
  readonly models: YunworkModels

  /**
   * @param credentials - the credentials document: the grant, the profile, the key and the route's record.
   * @param settings - the active Profile's configuration, where the model route goes.
   * @param shell - the desktop's window where there is one, the system browser otherwise.
   * @param config - this deployment's origins.
   * @param local - what the account may write, read live from the configuration.
   */
  constructor (
    private readonly credentials: CredentialProvider,
    settings: SettingsForms,
    private readonly shell: YunworkShell,
    private readonly config: YunworkConfig,
    private readonly local: () => LocalFiles,
  ) {
    this.models = new YunworkModels(credentials, settings, () => this.local().storeKey() && this.local().writeModels(), config.productName)
  }

  /** Pick up a stored grant and check the model route in the background. */
  async start (): Promise<void> {
    const grant = await this.readGrant()
    if (grant === undefined) return
    if (this.expired(grant)) {
      this.notice = { code: 'session-ended' }
      return
    }
    void this.refreshModels().catch(() => {})
  }

  dispose (): void {
    this.lifetime.abort()
    this.endAttempt('cancelled')
    this.shell.dispose()
  }

  private serial<T> (task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => {})
    return run
  }

  private async readGrant (): Promise<GrantRecord | undefined> {
    const record = await this.credentials.readRecord(GRANT_RECORD)
    return record?.kind === 'grant' && isGrant(record.payload) ? record.payload : undefined
  }

  private async readProfile (): Promise<ProfileRecord | undefined> {
    const record = await this.credentials.readRecord(PROFILE_RECORD)
    return record?.kind === 'grant' && isProfile(record.payload) ? record.payload : undefined
  }

  private async readSpeech (): Promise<SpeechRecord | undefined> {
    const record = await this.credentials.readRecord(SPEECH_RECORD)
    return record?.kind === 'grant' && isSpeech(record.payload) ? record.payload : undefined
  }

  private expired (grant: GrantRecord): boolean {
    return grant.expiresAt !== undefined && Date.parse(grant.expiresAt) <= Date.now()
  }

  /**
   * The language key the model traffic authenticates with: the stored one, else the credential reference, so a key
   * placed by a deployment keeps working without a sign-in.
   * @returns the `sk-`-prefixed key, or undefined while there is none.
   */
  async resolveLanguageKey (): Promise<string | undefined> {
    const speech = await this.readSpeech()
    if (speech !== undefined) return speech.key
    const resolved = await this.credentials.resolve(credentialRef(YUNWORK_API_KEY_REF))
    return resolved?.value
  }

  /** Everything the page shows. */
  async getState (): Promise<YunworkState> {
    const [grant, profile, catalog] = await Promise.all([this.readGrant(), this.readProfile(), this.models.view()])
    const ended = grant !== undefined && this.expired(grant)
    // A grant without a profile still means signed in: the token works and only the display fields are missing, so
    // reporting "not signed in" would strand the user — the sign-out button is the only way out of that state.
    const account: YunworkAccountView | undefined = profile !== undefined
      ? { displayName: profile.user.displayName || profile.user.username, username: profile.user.username, issuer: profile.issuer, connectedAt: grant?.connectedAt ?? '' }
      : grant === undefined ? undefined
        : { displayName: this.config.productName, username: '', issuer: grant.issuer, connectedAt: grant.connectedAt }
    const attempt = this.attempt
    const signIn: YunworkSignInView = attempt === undefined
      ? { phase: ended ? 'expired' : 'idle', ...(ended ? { error: { code: 'session-ended' as const } } : {}) }
      : {
          phase: attempt.phase,
          attemptId: attempt.id,
          ...(attempt.authorizeUrl === undefined ? {} : { authorizeUrl: attempt.authorizeUrl }),
          ...(attempt.error === undefined ? {} : { error: attempt.error }),
        }
    return {
      env: this.config.env,
      productName: this.config.productName,
      apiBaseUrl: this.config.apiBaseUrl,
      authBaseUrl: this.config.authBaseUrl,
      ...(account === undefined ? {} : { account }),
      signIn,
      models: { loaded: catalog.loaded, count: catalog.count, custom: catalog.custom, ...(catalog.error === undefined ? {} : { error: catalog.error }) },
      ...(this.notice === undefined ? {} : { notice: this.notice }),
    }
  }

  /** Fetch wallet balance and active subscription points for the signed-in account. */
  async getBalance (): Promise<YunworkBalanceView> {
    const grant = await this.readGrant()
    if (grant === undefined || this.expired(grant)) throw new YunworkApiError('session-ended')
    const balance = await fetchDesktopBalance({ authBaseUrl: this.config.authBaseUrl, token: grant.token, signal: this.lifetime.signal })
    const hasSubscription = balance.subscriptions.length > 0
    const planTitle = balance.subscriptions.length === 1 ? (balance.subscriptions[0]?.plan_title ?? undefined) : undefined
    if (balance.subscriptions.some(sub => sub.unlimited === true)) {
      return {
        walletBalance: balance.walletBalance,
        hasSubscription,
        remainingPoints: '0',
        totalPoints: '0',
        unlimited: true,
        ...(planTitle === undefined ? {} : { planTitle }),
      }
    }
    const remaining = balance.subscriptions.reduce((sum, sub) => sum + Number(sub.remaining_points), 0)
    const total = balance.subscriptions.reduce((sum, sub) => sum + Number(sub.total_points), 0)
    return {
      walletBalance: balance.walletBalance,
      hasSubscription,
      remainingPoints: Number.isInteger(remaining) ? String(remaining) : remaining.toFixed(2),
      totalPoints: Number.isInteger(total) ? String(total) : total.toFixed(2),
      ...(planTitle === undefined ? {} : { planTitle }),
    }
  }

  /** Fetch paginated usage logs for the signed-in account. */
  async getUsageLogs (query: { page?: number; pageSize?: number }): Promise<YunworkUsageLogsPage> {
    const grant = await this.readGrant()
    if (grant === undefined || this.expired(grant)) throw new YunworkApiError('session-ended')
    const data = await fetchDesktopUsageLogs({
      authBaseUrl: this.config.authBaseUrl,
      token: grant.token,
      query,
      signal: this.lifetime.signal,
    })
    return {
      page: data.page,
      pageSize: data.pageSize,
      total: data.total,
      items: data.items.map(item => ({
        id: item.id,
        createdAt: item.created_at,
        modelName: item.model_name,
        type: item.type,
        promptTokens: item.prompt_tokens,
        completionTokens: item.completion_tokens,
        quota: item.quota,
        subscriptionQuota: item.subscription_quota,
        useTime: item.use_time,
        ...(item.user_input == null ? {} : { userInput: item.user_input }),
        ...(item.user_input_truncated == null ? {} : { userInputTruncated: item.user_input_truncated }),
        ...(item.consumption == null ? {} : {
          consumption: {
            walletAmount: item.consumption.wallet_amount,
            walletUnit: item.consumption.wallet_unit,
            walletSymbol: item.consumption.wallet_symbol,
            subscriptionPoints: item.consumption.subscription_points,
            subscriptionUnit: item.consumption.subscription_unit,
          },
        }),
      })),
    }
  }

  /** Fetch paginated cloud conversations for the signed-in account. */
  async getConversations (query: { offset?: number; limit?: number }): Promise<YunworkConversationsPage> {
    const grant = await this.readGrant()
    if (grant === undefined || this.expired(grant)) throw new YunworkApiError('session-ended')
    const data = await fetchDesktopConversations({ authBaseUrl: this.config.authBaseUrl, token: grant.token, ...query, signal: this.lifetime.signal })
    return {
      hasMore: data.hasMore,
      items: data.items.map(item => ({
        id: item.id, title: item.title, revision: item.revision, createTime: item.create_time, updateTime: item.update_time,
      })),
    }
  }

  /** Fetch messages for one cloud conversation. */
  async getConversationMessages (id: string, query: { limit?: number }): Promise<YunworkConversationMessagesPage> {
    const grant = await this.readGrant()
    if (grant === undefined || this.expired(grant)) throw new YunworkApiError('session-ended')
    const data = await fetchDesktopConversationMessages({ authBaseUrl: this.config.authBaseUrl, token: grant.token, id, ...query, signal: this.lifetime.signal })
    return {
      revision: data.revision,
      hasMore: data.hasMore,
      items: data.items.map(item => ({
        id: item.id, sequence: item.sequence, payload: item.payload, createdAt: item.created_at,
      })),
    }
  }

  /** Start a sign-in, or bring back the window of the one already waiting. */
  signIn (): Promise<{ attemptId: string; authorizeUrl: string; opened: string }> {
    return this.serial(() => this.startAttempt())
  }

  private async startAttempt (): Promise<{ attemptId: string; authorizeUrl: string; opened: string }> {
    const current = this.attempt
    if (current?.phase === 'waiting-browser' && current.authorizeUrl !== undefined && current.callback !== undefined) {
      const opened = this.shell.openLogin(current.authorizeUrl, current.callback.redirectUri)
      return { attemptId: current.id, authorizeUrl: current.authorizeUrl, opened }
    }
    if (current !== undefined && (current.phase === 'exchanging' || current.phase === 'configuring')) throw new YunworkApiError('busy')
    this.endAttempt('cancelled')
    const attempt: Attempt = { id: randomUUID(), phase: 'waiting-browser', controller: new AbortController() }
    const callback: LoopbackCallback = new LoopbackCallback(result => this.serial(() => this.complete(attempt, callback, result)))
    await callback.listen()
    attempt.callback = callback
    attempt.authorizeUrl = desktopAuthorizeUrl(this.config.authBaseUrl, {
      redirectUri: callback.redirectUri, state: callback.state, challenge: callback.challenge,
    })
    attempt.timer = setTimeout(() => {
      if (attempt.phase === 'waiting-browser') this.finish(attempt, 'expired', { code: 'expired' })
    }, ATTEMPT_TIMEOUT_MS)
    attempt.timer.unref()
    this.attempt = attempt
    this.notice = undefined
    const opened = this.shell.openLogin(attempt.authorizeUrl, callback.redirectUri)
    return { attemptId: attempt.id, authorizeUrl: attempt.authorizeUrl, opened }
  }

  /** Drop the attempt that is waiting for the browser. */
  cancel (id: string): void {
    const attempt = this.attempt
    if (attempt?.id !== id || attempt.phase !== 'waiting-browser') return
    this.finish(attempt, 'cancelled', { code: 'cancelled' })
  }

  /** The user closed the sign-in window while it still waited. */
  windowClosed (): void {
    const attempt = this.attempt
    if (attempt?.phase === 'waiting-browser') this.finish(attempt, 'cancelled', { code: 'cancelled' })
  }

  private finish (attempt: Attempt, phase: YunworkSignInPhase, problem?: YunworkProblem): void {
    if (['succeeded', 'failed', 'cancelled', 'expired'].includes(attempt.phase)) return
    attempt.phase = phase
    if (problem !== undefined) attempt.error = problem
    clearTimeout(attempt.timer)
    attempt.controller.abort()
    attempt.callback?.close()
    // A cancelled attempt was the user's own doing, so the window closes without being brought forward.
    this.shell.closeLogin(phase !== 'cancelled')
  }

  private endAttempt (phase: YunworkSignInPhase): void {
    const attempt = this.attempt
    if (attempt !== undefined) this.finish(attempt, phase, { code: 'cancelled' })
  }

  /** Redeem the code, store the grant, the key and the profile, then set the route up. */
  private async complete (attempt: Attempt, callback: LoopbackCallback, result: CallbackResult): Promise<void> {
    if (this.attempt !== attempt || attempt.phase !== 'waiting-browser' || this.lifetime.signal.aborted) return
    if ('error' in result) {
      this.finish(attempt, result.error === 'access_denied' ? 'cancelled' : 'failed', {
        code: result.error === 'access_denied' ? 'denied' : 'rejected', detail: result.error,
      })
      return
    }
    const signal = attempt.controller.signal
    try {
      attempt.phase = 'exchanging'
      const token = await exchangeDesktopToken({
        authBaseUrl: this.config.authBaseUrl, code: result.code, verifier: callback.verifier, redirectUri: callback.redirectUri, signal,
      })
      const issuer = this.config.authBaseUrl
      const connectedAt = new Date().toISOString()
      const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString()
      const user = token.user
      attempt.phase = 'configuring'
      await this.credentials.modifyRecord(GRANT_RECORD, async () => ({
        kind: 'grant', payload: { version: 1, token: token.access_token, issuer, expiresAt, connectedAt } satisfies GrantRecord,
      }))
      await this.credentials.modifyRecord(SPEECH_RECORD, async () => ({
        kind: 'grant', payload: { version: 1, key: token.language_api_key, issuer } satisfies SpeechRecord,
      }))
      if (user !== undefined) {
        await this.credentials.modifyRecord(PROFILE_RECORD, async () => ({
          kind: 'grant',
          payload: {
            version: 1, issuer,
            user: { id: user.id, username: user.username, displayName: user.display_name, group: user.group },
          } satisfies ProfileRecord,
        }))
      }
      if (this.local().storeKey()) await this.credentials.set(credentialRef(YUNWORK_API_KEY_REF), token.language_api_key)
      // A model list that cannot be read is no reason to fail a sign-in whose key is already valid: the account stays
      // signed in, the page says why the route is empty, and a refresh retries.
      try {
        await this.models.load(this.config.apiBaseUrl, token.language_api_key, signal)
      } catch (error) {
        this.models.fail(error)
      }
      this.notice = undefined
      this.finish(attempt, 'succeeded')
    } catch (error) {
      if (signal.aborted) {
        this.finish(attempt, 'cancelled', { code: 'cancelled' })
        return
      }
      this.finish(attempt, 'failed', yunworkProblem(error))
    }
  }

  /** Read the model list again with the stored key and align the route with it. */
  refresh (): Promise<void> {
    return this.serial(() => this.refreshModels())
  }

  private async refreshModels (): Promise<void> {
    const key = await this.resolveLanguageKey()
    if (key === undefined) throw new YunworkApiError('session-ended')
    try {
      await this.models.load(this.config.apiBaseUrl, key, this.lifetime.signal)
      this.notice = undefined
    } catch (error) {
      this.models.fail(error)
      throw error
    }
  }

  /** Sign out: end the session at utoken, then forget the key, the route and the account. */
  signOut (): Promise<void> {
    return this.serial(async () => {
      this.endAttempt('cancelled')
      this.attempt = undefined
      const grant = await this.readGrant()
      if (grant !== undefined) await revokeSession({ authBaseUrl: grant.issuer, accessToken: grant.token, signal: AbortSignal.timeout(10_000) })
      await this.models.clear()
      await this.credentials.unset(credentialRef(YUNWORK_API_KEY_REF))
      await this.credentials.deleteRecord(SPEECH_RECORD)
      await this.credentials.deleteRecord(PROFILE_RECORD)
      await this.credentials.deleteRecord(GRANT_RECORD)
      this.notice = undefined
    })
  }

  /** Re-read the route after an edit landed in Settings → Models, so the page shows what it came to. */
  routesChanged (): void {
    void this.serial(() => this.models.apply()).catch(() => {})
  }
}
