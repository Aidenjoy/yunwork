/**
 * `@yundashi/dsh-yunwork-platform`: the 云大师 account as a DSH plugin.
 *
 * The Host face signs in to utoken, keeps the language key and writes the gateway as one `llm-pi-ai` route; the client
 * face adds the account page to Settings. Nothing here depends on the desktop edition: where DSH Next serves its
 * sign-in window the account uses it, and anywhere else the authorize page opens in the system browser.
 */
import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { YUNWORK_ROUTES, type YunworkProblem, type YunworkReply } from './shared.ts'
import { YunworkAccount } from './host/account.ts'
import { collectDiagnostics } from './host/diagnostics.ts'
import { YunworkConfigError, loadRuntimeConfig, type YunworkConfig } from './host/env-config.ts'
import { PI_AI_ENTRY } from './host/models.ts'
import { YunworkSettings } from './host/settings.ts'
import { YunworkShell, desktopSignInShell } from './host/shell.ts'

export const name = 'yunwork-platform'

const NO_STORE = { 'cache-control': 'no-store' }

/** The page changes these, so a change never reloads the plugin. */
export interface Config {
  /** The gateway origin, which the model route points at. Pinned here, it wins over the environment. */
  apiBaseUrl: Volatile<string | undefined>
  /** The authorization server origin. Pinned here, it wins over the environment. */
  authBaseUrl: Volatile<string | undefined>
  /** Accept plain http for those origins; only an intranet or loopback host should need it. */
  insecure: Volatile<boolean | undefined>
  /** Keep the account's language key in DSH's credentials document, where the model route reads it. */
  storeKey: Volatile<boolean>
  /** Write the account's models into the active Profile's configuration; they need the stored key. */
  writeModels: Volatile<boolean>
}

export const Config = z.object({
  apiBaseUrl: z.string().volatile().description('The gateway origin the model route points at.'),
  authBaseUrl: z.string().volatile().description('The utoken authorization server origin.'),
  insecure: z.boolean().volatile().description('Accept plain http for those origins; an intranet or loopback host only.'),
  storeKey: z.boolean().default(true).volatile().description('Keep the account\'s language key in the credentials document.'),
  writeModels: z.boolean().default(true).volatile().description('Write the account\'s models into the Profile configuration.'),
})

export function apply (ctx: Context, config: Config): void {
  // The plugin draws its own page; Settings builds none from this Config.
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber), 'yunwork: own settings page')
  })
  const settings = new YunworkSettings(ctx, config)
  installYunworkAccount(ctx, config, settings)
}

/**
 * Mount the account's Host routes while the connection, credentials and settings services are up, and use the
 * desktop's sign-in window whenever its shell serves one.
 */
function installYunworkAccount (ctx: Context, config: Config, settings: YunworkSettings): void {
  ctx.inject(['connection', 'credentials', 'settings'], (inner) => {
    // A diagnosis answers in exactly the states that stop everything else, so it is registered before the deployment
    // is resolved, and it never reports a path it assembled itself.
    let deployment: YunworkConfig | undefined
    const diagnose = async (): Promise<Response> => Response.json(
      await collectDiagnostics({ ctx: inner, credentials: inner.credentials, settings: inner.settings, ...(deployment === undefined ? {} : { config: deployment }) }),
      { headers: NO_STORE },
    )
    const registerDiagnosis = (): void => {
      inner.connection.fetch.register({ path: YUNWORK_ROUTES.diagnostics, methods: ['GET'], requestBody: 'buffered', fetch: diagnose })
    }
    try {
      deployment = loadRuntimeConfig({
        overrides: { apiBaseUrl: config.apiBaseUrl.get(), authBaseUrl: config.authBaseUrl.get(), insecure: config.insecure.get() },
      })
    } catch (error) {
      // A composition that names no origin still loads: the diagnosis says what is missing instead of the plugin vanishing.
      const problem: YunworkProblem = { code: 'not-configured', detail: error instanceof YunworkConfigError || error instanceof Error ? error.message : String(error) }
      console.error('[yunwork-platform] No deployment origin:', problem.detail)
      registerDiagnosis()
      for (const path of Object.values(YUNWORK_ROUTES).filter(item => item !== YUNWORK_ROUTES.diagnostics)) {
        inner.connection.fetch.register({
          path, methods: ['GET', 'POST'], requestBody: 'buffered',
          fetch: async () => Response.json({ error: problem } satisfies YunworkReply, { status: 409, headers: NO_STORE }),
        })
      }
      return
    }
    const runtime: YunworkConfig = deployment
    registerDiagnosis()

    let account: YunworkAccount | undefined
    const shell = new YunworkShell(() => { account?.windowClosed() })
    account = new YunworkAccount(inner.credentials, inner.settings, shell, runtime, () => settings.local())
    const current = account
    inner.effect(() => () => { current.dispose() }, 'yunwork account sign-in')

    // The Desktop's service comes and goes with its own generation; the account outlives it.
    inner.inject(['desktopTokensAnywhere'], (desktop) => {
      const service = desktopSignInShell(desktop)
      if (service === undefined) return
      desktop.effect(() => shell.attach(service), 'yunwork account: desktop sign-in window')
    })

    void current.start().catch((error: unknown) => { console.error('[yunwork-platform] The account did not start', error) })

    // An edit saved in Settings → Models lands in the route's namespace: settle it now, not at the next list read.
    inner.on('settings/document-updated', (ns: string) => {
      if (ns === PI_AI_ENTRY) current.routesChanged()
    })

    const act = async (request: Request, run: (body: Record<string, unknown>) => Promise<unknown>): Promise<Response> => {
      let body: Record<string, unknown> = {}
      if (request.method === 'POST') {
        try {
          const text = await request.text()
          const parsed: unknown = text === '' ? {} : JSON.parse(text)
          if (typeof parsed === 'object' && parsed !== null) body = parsed as Record<string, unknown>
        } catch {
          return Response.json({ error: { code: 'failed' } } satisfies YunworkReply, { status: 400, headers: NO_STORE })
        }
      }
      try {
        const result = await run(body)
        return Response.json({ ...(result === undefined ? {} : { result }), state: await current.getState() } satisfies YunworkReply, { headers: NO_STORE })
      } catch (error) {
        const problem = error instanceof Error && 'problem' in error
          ? (error as { problem: YunworkProblem }).problem
          : { code: 'failed' as const }
        if (problem.code === 'failed') console.error('[yunwork-platform] Account request failed', error)
        return Response.json({ error: problem, state: await current.getState() } satisfies YunworkReply, { status: 409, headers: NO_STORE })
      }
    }

    const routes: [string, 'GET' | 'POST', (body: Record<string, unknown>, request: Request) => Promise<unknown>][] = [
      [YUNWORK_ROUTES.state, 'GET', async () => undefined],
      [YUNWORK_ROUTES.signIn, 'POST', () => current.signIn()],
      [YUNWORK_ROUTES.cancel, 'POST', async (body) => { current.cancel(String(body.id ?? '')) }],
      [YUNWORK_ROUTES.signOut, 'POST', () => current.signOut()],
      [YUNWORK_ROUTES.refresh, 'POST', () => current.refresh()],
      [YUNWORK_ROUTES.balance, 'GET', () => current.getBalance()],
      [YUNWORK_ROUTES.usageLogs, 'GET', (_body, request) => {
        const url = new URL(request.url)
        const page = Number(url.searchParams.get('page') ?? '1')
        const pageSize = Number(url.searchParams.get('pageSize') ?? '5')
        return current.getUsageLogs({
          ...(Number.isInteger(page) && page > 0 ? { page } : {}),
          ...(Number.isInteger(pageSize) && pageSize > 0 ? { pageSize } : {}),
        })
      }],
      [YUNWORK_ROUTES.conversations, 'GET', (_body, request) => {
        const url = new URL(request.url)
        const offset = Number(url.searchParams.get('offset') ?? '0')
        const limit = Number(url.searchParams.get('limit') ?? '30')
        return current.getConversations({
          ...(Number.isInteger(offset) && offset >= 0 ? { offset } : {}),
          ...(Number.isInteger(limit) && limit > 0 ? { limit } : {}),
        })
      }],
      [YUNWORK_ROUTES.conversationMessages, 'GET', (_body, request) => {
        const url = new URL(request.url)
        const id = url.searchParams.get('id')?.trim() ?? ''
        if (id === '') throw Object.assign(new Error('missing id'), { problem: { code: 'failed', detail: 'missing id' } })
        const limit = Number(url.searchParams.get('limit') ?? '50')
        return current.getConversationMessages(id, {
          ...(Number.isInteger(limit) && limit > 0 ? { limit } : {}),
        })
      }],
    ]
    for (const [path, method, run] of routes) {
      inner.connection.fetch.register({ path, methods: [method], requestBody: 'buffered', fetch: (request: Request) => act(request, body => run(body, request)) })
    }
  })
}
