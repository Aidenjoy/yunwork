/**
 * Contracts shared by both faces of `@yundashi/dsh-yunwork-platform`: the Host routes the page calls, and the shapes
 * they answer with. Shared by the Host and the renderer, so this module imports nothing at runtime — the renderer
 * bundle only carries the constants and the types disappear.
 */

/** Host routes; GET reads, POST acts with a JSON body. */
export const YUNWORK_ROUTES = {
  /** GET: the account, the sign-in attempt and the model routes as they now stand. */
  state: '/api/yunwork/state',
  /** POST: start a sign-in, or bring the window of the one already waiting back. */
  signIn: '/api/yunwork/sign-in',
  /** POST `{ id }`: drop the sign-in attempt that is waiting for the browser. */
  cancel: '/api/yunwork/sign-in/cancel',
  /** POST: end the grant at utoken and forget everything stored here. */
  signOut: '/api/yunwork/sign-out',
  /** POST: read the model list again and align the routes with it. */
  refresh: '/api/yunwork/refresh',
  /** GET: wallet balance and subscription points. */
  balance: '/api/yunwork/balance',
  /** GET: paginated model usage logs. */
  usageLogs: '/api/yunwork/usage-logs',
  /** GET: paginated cloud conversations. */
  conversations: '/api/yunwork/conversations',
  /** GET: paginated messages for one cloud conversation. */
  conversationMessages: '/api/yunwork/conversation-messages',
  /**
   * GET: a read-only report of where the contract, the profile, the credential and the route really are. Every route
   * lives under `/api`, which is the only prefix the Host's web transport owns (dsh-client-connection `API_PATH`), so a
   * diagnosis outside it would answer nothing.
   */
  diagnostics: '/api/yunwork/diagnostics',
} as const

/** The credential reference the model route reads its key from; `llm-pi-ai` resolves it per request. */
export const YUNWORK_API_KEY_REF = 'YUNWORK_API_KEY'

/** Why something the page asked for did not happen. */
export type YunworkProblemCode =
  /** utoken could not be reached at all. */
  | 'network'
  /** utoken answered with a server failure. */
  | 'server'
  /** utoken refused the request. */
  | 'rejected'
  /** The stored token is gone or expired: only signing in again helps. */
  | 'session-ended'
  /** The user declined the authorization page. */
  | 'denied'
  /** The attempt was cancelled from this side. */
  | 'cancelled'
  /** The attempt waited for the browser too long. */
  | 'expired'
  /** Another attempt is already past the browser step. */
  | 'busy'
  /** The account's list held no model the route can call. */
  | 'no-models'
  /** The list has not been read yet. */
  | 'no-catalog'
  /** No deployment origin is configured, so nothing can be called. */
  | 'not-configured'
  /** Anything unexpected. */
  | 'failed'

/** A failure as the page shows it; `detail` is utoken's own wording, when it gives one. */
export interface YunworkProblem {
  readonly code: YunworkProblemCode
  readonly detail?: string
}

/** Where a sign-in attempt stands. */
export type YunworkSignInPhase =
  | 'idle'
  | 'waiting-browser'
  | 'exchanging'
  | 'configuring'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'expired'

/**
 * Whether the browser is still on its way back. These are the phases in which the page has to ask again: the code is
 * redeemed by the Host, so nothing the page does can make the answer arrive sooner.
 * @param phase - the attempt's phase as the last answer reported it.
 * @returns true while the attempt is between opening the browser and settling.
 */
export function isSignInInFlight (phase: YunworkSignInPhase): boolean {
  return phase === 'waiting-browser' || phase === 'exchanging' || phase === 'configuring'
}

/** The stored account, display fields only: never a token, never a key. */
export interface YunworkAccountView {
  readonly displayName: string
  readonly username: string
  /** The authorization server that issued the grant; tokens and keys work nowhere else. */
  readonly issuer: string
  readonly connectedAt: string
}

/** The sign-in attempt, as the page draws it. */
export interface YunworkSignInView {
  readonly phase: YunworkSignInPhase
  readonly attemptId?: string
  /** The page the browser must open; present while the attempt waits for it. */
  readonly authorizeUrl?: string
  readonly error?: YunworkProblem
}

/** The model route, as the page reports it. */
export interface YunworkModelsView {
  /** The list was read since the Host started. */
  readonly loaded: boolean
  /** How many models the route offers. */
  readonly count: number
  /** Whether the route in the Profile is the user's to edit, in which case the list never rewrites it. */
  readonly custom: boolean
  readonly error?: YunworkProblem
}

/** Everything the page shows in one answer. */
export interface YunworkState {
  /** The brand environment this Host runs in: `dev`, `test` or `prod`. */
  readonly env: string
  readonly productName: string
  /** The gateway origin the model route points at. */
  readonly apiBaseUrl: string
  /** The authorization server origin. */
  readonly authBaseUrl: string
  readonly account?: YunworkAccountView
  readonly signIn: YunworkSignInView
  readonly models: YunworkModelsView
  /** A one-off notice, such as a session that ended on its own. */
  readonly notice?: YunworkProblem
}

/** What a Host route answers: the action's own result, the state after it, or why it failed. */
export interface YunworkReply<T = unknown> {
  readonly result?: T
  readonly state?: YunworkState
  readonly error?: YunworkProblem
}

/** Wallet balance and active subscription summary. */
export interface YunworkBalanceView {
  readonly walletBalance: string
  readonly hasSubscription: boolean
  readonly remainingPoints: string
  readonly totalPoints: string
  readonly unlimited?: boolean
  readonly planTitle?: string
}

/** One usage log row. */
export interface YunworkUsageLogItem {
  readonly id: number
  readonly createdAt: number
  readonly modelName: string
  readonly type: number
  readonly promptTokens: number
  readonly completionTokens: number
  readonly quota: number
  readonly subscriptionQuota: number
  readonly useTime: number
  readonly userInput?: string
  readonly userInputTruncated?: boolean
  readonly consumption?: {
    readonly walletAmount: number
    readonly walletUnit: string
    readonly walletSymbol: string
    readonly subscriptionPoints: number
    readonly subscriptionUnit: string
  }
}

/** One page of usage logs. */
export interface YunworkUsageLogsPage {
  readonly page: number
  readonly pageSize: number
  readonly total: number
  readonly items: readonly YunworkUsageLogItem[]
}

/** One cloud conversation summary. */
export interface YunworkConversationSummary {
  readonly id: string
  readonly title: string
  readonly revision: number
  readonly createTime: string
  readonly updateTime: string
}

/** One page of cloud conversations. */
export interface YunworkConversationsPage {
  readonly items: readonly YunworkConversationSummary[]
  readonly hasMore: boolean
}

/** One cloud conversation message. */
export interface YunworkConversationMessage {
  readonly id: string
  readonly sequence: number
  readonly payload: Record<string, unknown>
  readonly createdAt: string
}

/** One page of cloud conversation messages. */
export interface YunworkConversationMessagesPage {
  readonly revision: number
  readonly items: readonly YunworkConversationMessage[]
  readonly hasMore: boolean
}
