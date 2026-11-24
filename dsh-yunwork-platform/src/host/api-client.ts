/**
 * utoken's desktop API, as this plugin uses it: the authorize page, the code exchange, the wallet balance, the usage
 * log and the revocation, plus the gateway's text model list. Nothing here imports the old repository — the wire
 * contract was re-derived from it and is written down in one place, this file.
 *
 * Three properties hold for every call: it never follows a redirect (a token or a key travels in these requests),
 * every answer is bounded by a timeout, and every response shape is validated before anything is stored, so a
 * changed server can never write a half-formed grant into the credentials document.
 */
import { z } from 'zod'
import type { YunworkProblem } from '../shared.ts'

/** The public client utoken registers for this desktop application. */
export const DESKTOP_CLIENT_ID = 'yun-token-desktop'

/** The loopback path utoken redirects to; it accepts no other shape of redirect URI. */
export const DESKTOP_CALLBACK_PATH = '/desktop-auth/callback'

const REQUEST_TIMEOUT_MS = 20_000
/** The wallet balance carries its subscriptions; a page of usage logs is the largest answer we ask for. */
const BALANCE_MAX_BYTES = 65_536
const USAGE_MAX_BYTES = 524_288

/** A failure the account page shows. */
export class YunworkApiError extends Error {
  constructor (readonly code: YunworkProblem['code'], readonly detail?: string) {
    super(detail === undefined ? code : `${code}: ${detail}`)
    this.name = 'YunworkApiError'
  }

  get problem (): YunworkProblem {
    return this.detail === undefined ? { code: this.code } : { code: this.code, detail: this.detail }
  }
}

/** Any failure as the page shows it; an unexpected one is `failed`. */
export function yunworkProblem (error: unknown): YunworkProblem {
  return error instanceof YunworkApiError ? error.problem : { code: 'failed' }
}

/** A decimal the server sends as a string or number (including scientific notation like 0E-16). */
const decimal = z.union([z.number().transform(String), z.string().regex(/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i)])

/** The account snapshot utoken attaches to a code exchange; display only, so a shape drift degrades to no profile. */
const desktopUser = z.object({
  id: z.number().int(),
  username: z.string(),
  display_name: z.string(),
  role: z.number().int(),
  group: z.string(),
})

/** A successful desktop code exchange. */
export const desktopToken = z.object({
  // An opaque bearer token: the server decides its shape, so only the character class is checked. A fixed length would
  // reject every token format the server adopts later, and a JSON Web Token would fail it today.
  access_token: z.string().regex(/^[A-Za-z0-9._~+/-]{20,2048}={0,2}$/),
  token_type: z.literal('Bearer'),
  expires_in: z.number().int().positive(),
  /** The language key both the model route and the speech endpoint authenticate with. */
  language_api_key: z.string().regex(/^sk-[A-Za-z0-9_-]+$/),
  user: desktopUser.optional().catch(undefined),
})

export type DesktopToken = z.infer<typeof desktopToken>

/** One active subscription's remaining quota. */
const subscription = z.object({
  plan_title: z.string().nullish(),
  total_points: decimal,
  used_points: decimal.nullish(),
  remaining_points: decimal,
  unlimited: z.boolean().nullish().default(false),
  end_time: z.number().int().nullish(),
})

/** `GET /api/desktop-auth/balance`; `wallet_balance` is already the site's own currency. */
const balanceEnvelope = z.object({
  success: z.literal(true),
  data: z.object({
    wallet_balance: decimal,
    quota_display_type: z.string().nullish(),
    subscriptions: z.array(subscription).nullish(),
  }),
})

/** The wallet and subscriptions as the page shows them. */
export interface DesktopBalance {
  readonly walletBalance: string
  readonly subscriptions: readonly z.infer<typeof subscription>[]
}

/** `GET /api/desktop-auth/balance`. */
export async function fetchDesktopBalance ({ authBaseUrl, token, signal }: {
  readonly authBaseUrl: string
  readonly token: string
  readonly signal: AbortSignal
}): Promise<DesktopBalance> {
  const url = new URL('/api/desktop-auth/balance', authBaseUrl).href
  const raw = await sendJson(url, { headers: { authorization: `Bearer ${token}` } }, { signal, maxBytes: BALANCE_MAX_BYTES })
  const parsed = checked(balanceEnvelope, raw, 'balance')
  return {
    walletBalance: parsed.data.wallet_balance,
    subscriptions: parsed.data.subscriptions ?? [],
  }
}

/** One usage log row. */
const usageLogItem = z.object({
  id: z.number().int(),
  created_at: z.number().int(),
  model_name: z.string(),
  type: z.number().int().default(0),
  prompt_tokens: z.number().int().default(0),
  completion_tokens: z.number().int().default(0),
  quota: z.number().default(0),
  subscription_quota: z.number().default(0),
  use_time: z.number().default(0),
  user_input: z.string().nullish(),
  user_input_truncated: z.boolean().nullish(),
  consumption: z.object({
    wallet_amount: z.number(),
    wallet_unit: z.string(),
    wallet_symbol: z.string(),
    subscription_points: z.number(),
    subscription_unit: z.string(),
  }).nullish(),
})

/** `GET /api/desktop/usage-logs`. */
const usageLogsEnvelope = z.object({
  success: z.literal(true),
  message: z.string().optional(),
  data: z.object({
    page: z.number().int(),
    page_size: z.number().int(),
    total: z.number().int(),
    items: z.array(usageLogItem).nullish(),
  }),
})

/** One page of usage logs. */
export interface DesktopUsageLogs {
  readonly page: number
  readonly pageSize: number
  readonly total: number
  readonly items: readonly z.infer<typeof usageLogItem>[]
}

/** How many rows to ask for, and which ones. */
export interface UsageLogQuery {
  readonly page?: number
  readonly pageSize?: number
  /** Unix seconds, inclusive. */
  readonly startTimestamp?: number
  /** Unix seconds, inclusive. */
  readonly endTimestamp?: number
  readonly modelName?: string
}

/** `GET /api/desktop/usage-logs`. */
export async function fetchDesktopUsageLogs ({ authBaseUrl, token, query, signal }: {
  readonly authBaseUrl: string
  readonly token: string
  readonly query: UsageLogQuery
  readonly signal: AbortSignal
}): Promise<DesktopUsageLogs> {
  const url = new URL('/api/desktop/usage-logs', authBaseUrl)
  const pageSize = typeof query.pageSize === 'number' && Number.isInteger(query.pageSize) ? Math.min(100, Math.max(1, query.pageSize)) : 20
  const maxPage = Math.floor(9_999 / pageSize) + 1
  const page = typeof query.page === 'number' && Number.isInteger(query.page) ? Math.min(maxPage, Math.max(1, query.page)) : 1
  url.searchParams.set('p', String(page))
  url.searchParams.set('page_size', String(pageSize))
  const raw = await sendJson(url.href, { headers: { authorization: `Bearer ${token}` } }, { signal, maxBytes: USAGE_MAX_BYTES })
  const parsed = checked(usageLogsEnvelope, raw, 'usage logs')
  return {
    page: parsed.data.page,
    pageSize: parsed.data.page_size,
    total: parsed.data.total,
    items: parsed.data.items ?? [],
  }
}

const conversationSummary = z.object({
  id: z.string(),
  title: z.string(),
  revision: z.number().int(),
  create_time: z.string(),
  update_time: z.string(),
})

const conversationsEnvelope = z.object({
  success: z.literal(true),
  data: z.object({
    items: z.array(conversationSummary).nullish(),
    has_more: z.boolean(),
  }),
})

const conversationMessage = z.object({
  id: z.string(),
  sequence: z.number().int(),
  payload: z.record(z.string(), z.unknown()),
  created_at: z.string(),
})

const conversationMessagesEnvelope = z.object({
  success: z.literal(true),
  data: z.object({
    revision: z.number().int(),
    items: z.array(conversationMessage).nullish(),
    has_more: z.boolean(),
  }),
})

/** `GET /api/desktop/conversations`. */
export async function fetchDesktopConversations ({ authBaseUrl, token, offset = 0, limit = 30, signal }: {
  readonly authBaseUrl: string
  readonly token: string
  readonly offset?: number
  readonly limit?: number
  readonly signal: AbortSignal
}) {
  const url = new URL('/api/desktop/conversations', authBaseUrl)
  url.searchParams.set('offset', String(Math.max(0, offset)))
  url.searchParams.set('limit', String(Math.min(100, Math.max(1, limit))))
  const raw = await sendJson(url.href, { headers: { authorization: `Bearer ${token}` } }, { signal, maxBytes: USAGE_MAX_BYTES })
  const parsed = checked(conversationsEnvelope, raw, 'conversations')
  return { items: parsed.data.items ?? [], hasMore: parsed.data.has_more }
}

/** `GET /api/desktop/conversations/:id/messages`. */
export async function fetchDesktopConversationMessages ({ authBaseUrl, token, id, limit = 50, signal }: {
  readonly authBaseUrl: string
  readonly token: string
  readonly id: string
  readonly limit?: number
  readonly signal: AbortSignal
}) {
  const url = new URL(`/api/desktop/conversations/${encodeURIComponent(id)}/messages`, authBaseUrl)
  url.searchParams.set('limit', String(Math.min(200, Math.max(1, limit))))
  const raw = await sendJson(url.href, { headers: { authorization: `Bearer ${token}` } }, { signal, maxBytes: USAGE_MAX_BYTES })
  const parsed = checked(conversationMessagesEnvelope, raw, 'conversation messages')
  return {
    revision: parsed.data.revision,
    items: parsed.data.items ?? [],
    hasMore: parsed.data.has_more,
  }
}

/** One text model the gateway offers. */
export interface TextModel {
  readonly id: string
  readonly name: string
  /** utoken's own classification; absent on releases that do not send it. */
  readonly type?: string
}

/** `GET /v1/modelsinfo?type=text`. */
const modelListing = z.object({
  data: z.array(z.object({
    id: z.string().min(1),
    name: z.string().nullish(),
    type: z.string().nullish(),
  })),
})

/** The loopback redirect URI for a listener on `port`; utoken accepts only the 127.0.0.1 spelling. */
export function desktopRedirectUri (port: number): string {
  return `http://127.0.0.1:${port}${DESKTOP_CALLBACK_PATH}`
}

/**
 * The authorize page one attempt opens.
 * @param authBaseUrl - the authorization server origin.
 * @param attempt - the exact redirect URI the listener is on, its state and the PKCE challenge.
 * @returns the absolute URL to open.
 */
export function desktopAuthorizeUrl (authBaseUrl: string, attempt: { redirectUri: string; state: string; challenge: string }): string {
  const url = new URL('/api/desktop-auth/authorize', authBaseUrl)
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: DESKTOP_CLIENT_ID,
    redirect_uri: attempt.redirectUri,
    state: attempt.state,
    code_challenge: attempt.challenge,
    code_challenge_method: 'S256',
  }).toString()
  return url.href
}

interface RequestOptions {
  readonly signal: AbortSignal
  readonly maxBytes?: number
}

/**
 * Send one request and read a bounded JSON answer.
 * @throws YunworkApiError for an unreachable host, a server failure or an unreadable body.
 */
async function sendJson (url: string, init: RequestInit, options: RequestOptions): Promise<unknown> {
  const { signal } = options
  const limit = options.maxBytes ?? BALANCE_MAX_BYTES
  let response: Response
  try {
    response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) })
  } catch (error) {
    if (signal.aborted) throw error
    throw new YunworkApiError('network')
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    if (response.status === 401) throw new YunworkApiError('session-ended')
    throw new YunworkApiError(response.status >= 500 ? 'server' : 'rejected', `HTTP ${response.status}`)
  }
  let text: string
  try {
    text = await response.text()
  } catch {
    throw new YunworkApiError('network')
  }
  if (text.length > limit) throw new YunworkApiError('server', 'response too large')
  try {
    return text === '' ? undefined : JSON.parse(text)
  } catch {
    throw new YunworkApiError('server', 'malformed response')
  }
}

function checked<T> (schema: z.ZodType<T>, value: unknown, what: string): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new YunworkApiError('server', `malformed ${what}`)
  return parsed.data
}

/**
 * Redeem an authorization code with its PKCE verifier.
 * @returns the access token, its lifetime and the language key.
 */
export async function exchangeDesktopToken (options: {
  authBaseUrl: string
  code: string
  verifier: string
  redirectUri: string
  signal: AbortSignal
}): Promise<DesktopToken> {
  const body = await sendJson(`${options.authBaseUrl}/api/desktop-auth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: DESKTOP_CLIENT_ID,
      code: options.code,
      redirect_uri: options.redirectUri,
      code_verifier: options.verifier,
    }).toString(),
  }, { signal: options.signal })
  return checked(desktopToken, body, 'token response')
}

/** Read the wallet balance and the active subscriptions. */
export async function requestBalance (options: {
  authBaseUrl: string
  accessToken: string
  signal: AbortSignal
}): Promise<DesktopBalance> {
  const body = await sendJson(`${options.authBaseUrl}/api/desktop-auth/balance`, {
    method: 'GET',
    headers: { accept: 'application/json', authorization: `Bearer ${options.accessToken}` },
  }, { signal: options.signal, maxBytes: BALANCE_MAX_BYTES })
  const parsed = checked(balanceEnvelope, body, 'balance response')
  return { walletBalance: parsed.data.wallet_balance, subscriptions: parsed.data.subscriptions ?? [] }
}

/**
 * Read one page of model usage logs.
 * @param query - page and filters; the server caps a page at 100 rows and the offset at 9999, so both are clamped here.
 */
export async function requestUsageLogs (options: {
  authBaseUrl: string
  accessToken: string
  query?: UsageLogQuery
  signal: AbortSignal
}): Promise<DesktopUsageLogs> {
  const query = options.query ?? {}
  const rawSize = query.pageSize
  const pageSize = typeof rawSize === 'number' && Number.isInteger(rawSize) ? Math.min(100, Math.max(1, rawSize)) : 20
  const maxPage = Math.floor(9_999 / pageSize) + 1
  const rawPage = query.page
  const page = typeof rawPage === 'number' && Number.isInteger(rawPage) ? Math.min(maxPage, Math.max(1, rawPage)) : 1
  const url = new URL('/api/desktop/usage-logs', options.authBaseUrl)
  url.searchParams.set('p', String(page))
  url.searchParams.set('page_size', String(pageSize))
  if (typeof query.startTimestamp === 'number' && Number.isInteger(query.startTimestamp) && query.startTimestamp > 0) {
    url.searchParams.set('start_timestamp', String(query.startTimestamp))
  }
  if (typeof query.endTimestamp === 'number' && Number.isInteger(query.endTimestamp) && query.endTimestamp > 0) {
    url.searchParams.set('end_timestamp', String(query.endTimestamp))
  }
  // The server bounds the filter by bytes, so a long name is dropped rather than refused.
  if (typeof query.modelName === 'string' && query.modelName !== '' && Buffer.byteLength(query.modelName, 'utf8') <= 256) {
    url.searchParams.set('model_name', query.modelName)
  }
  const body = await sendJson(url.href, {
    method: 'GET',
    headers: { accept: 'application/json', authorization: `Bearer ${options.accessToken}` },
  }, { signal: options.signal, maxBytes: USAGE_MAX_BYTES })
  const parsed = checked(usageLogsEnvelope, body, 'usage-log response')
  return { page: parsed.data.page, pageSize: parsed.data.page_size, total: parsed.data.total, items: parsed.data.items ?? [] }
}

/**
 * End the session at utoken. Best effort: a failure here must never keep the user signed in locally.
 * @returns whether the server accepted the revocation.
 */
export async function revokeSession (options: { authBaseUrl: string; accessToken: string; signal: AbortSignal }): Promise<boolean> {
  try {
    const response = await fetch(`${options.authBaseUrl}/api/desktop-auth/revoke`, {
      method: 'POST',
      headers: { authorization: `Bearer ${options.accessToken}` },
      redirect: 'error',
      signal: AbortSignal.any([options.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    })
    await response.body?.cancel().catch(() => undefined)
    return response.ok || response.status === 401
  } catch {
    return false
  }
}

/**
 * List the text models the language key may call.
 * @param options.apiBaseUrl - the gateway origin; the listing lives under `/v1`.
 * @param options.apiKey - the account's language key.
 */
export async function fetchTextModels (options: { apiBaseUrl: string; apiKey: string; signal: AbortSignal }): Promise<TextModel[]> {
  const body = await sendJson(`${options.apiBaseUrl}/v1/modelsinfo?type=text`, {
    method: 'GET',
    headers: { accept: 'application/json', authorization: `Bearer ${options.apiKey}` },
  }, { signal: options.signal, maxBytes: USAGE_MAX_BYTES })
  const parsed = checked(modelListing, body, 'model list')
  return parsed.data.flatMap(item => item.id.trim() === ''
    ? []
    : [{ id: item.id, name: item.name ?? item.id, ...(item.type === null || item.type === undefined ? {} : { type: item.type }) }])
}
