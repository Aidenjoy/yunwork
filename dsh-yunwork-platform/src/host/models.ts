/**
 * The account's models, as one `llm-pi-ai` provider route in the active Profile.
 *
 * The gateway serves the text models over Anthropic Messages, so the route declares that protocol and the gateway
 * origin as its base URL — `llm-pi-ai` appends `/v1/messages` itself, and appending `/v1` here would double it.
 *
 * An edit made in Settings → Models is never overwritten. The fingerprint of the route as last written is kept beside
 * the account: a Profile that no longer matches it was edited by hand, and from then on the route belongs to the user
 * and reading the list only reports it. Writes name the revision they were decided at, and one that lands in between
 * is read again rather than written over.
 */
import { createHash } from 'node:crypto'
import { credentialKey, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { SettingsForms, SettingsPathOp } from '@deepseek-ai/dsh-settings'
import { YUNWORK_API_KEY_REF, type YunworkModelsView, type YunworkProblem } from '../shared.ts'
import { YunworkApiError, fetchTextModels, yunworkProblem, type TextModel } from './api-client.ts'

/** The settings namespace the route lives in, which Settings → Models edits too. */
export const PI_AI_ENTRY = 'llm-pi-ai'

/** The one route this plugin writes; no other route name ever belongs to it. */
export const ROUTE_ID = 'yunwork'

/** How the route is managed, kept across restarts. */
const MODELS_RECORD = credentialKey('yunwork', 'models')

/** How often one follow reads the route again after an edit landed between its read and its write. */
const MAX_CONFLICTS = 3

/** One model as an `llm-pi-ai` route lists it. */
export interface PiAiRouteModel {
  readonly id: string
  readonly name: string
  /** Absent unless the listing said which inputs the model takes; the provider library's own default applies. */
  readonly input?: readonly ('text' | 'image')[]
  readonly contextWindow?: number
  readonly maxTokens?: number
}

/** One `llm-pi-ai` provider route. */
export interface PiAiRoute {
  readonly displayName: string
  readonly apiKeyEnv: string
  readonly api: string
  readonly baseURL: string
  readonly models: readonly PiAiRouteModel[]
}

/** JSON with sorted keys: a settings round trip may reorder them. */
export function stableJson (value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => typeof item === 'object' && item !== null && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
    : item)
}

/**
 * The route these models and this origin make.
 * @param models - the text models the listing named.
 * @param apiBaseUrl - the gateway origin; `llm-pi-ai` appends `/v1/messages` itself.
 * @param productName - the deployment's own name, which the route shows in Settings → Models.
 */
export function yunworkRoute (models: readonly TextModel[], apiBaseUrl: string, productName: string): PiAiRoute {
  return {
    displayName: `${productName} (Utoken)`,
    api: 'openai-completions',
    apiKeyEnv: YUNWORK_API_KEY_REF,
    baseURL: `${apiBaseUrl.replace(/\/+$/, '')}/v1`,
    // The listing says nothing about window or output cap, nor which inputs a model accepts: it lists `id`, `name` and
    // a `type` that only echoes the `?type=text` filter. Declaring any of them would state a limit or a capability the
    // server never did, so all three stay absent and the provider library's own defaults apply.
    models: models.map(model => ({ id: model.id, name: model.name === '' ? model.id : model.name })),
  }
}

/** Whether a stored provider route is ours. */
export function isYunworkRoute (id: string, route: { readonly apiKeyEnv?: unknown } | undefined): boolean {
  return id === ROUTE_ID && route?.apiKeyEnv === YUNWORK_API_KEY_REF
}

function fingerprint (value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

/** A write the settings refused because the Profile changed since it was read. */
function isConflict (error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'SETTINGS_CONFLICT'
}

interface ModelsRecord {
  /** The route is the user's to edit; the list no longer rewrites it. */
  readonly custom: boolean
  /** The route's fingerprint as last written from the list. */
  readonly written?: string
}

/** What the model list amounts to, for the page. */
export interface YunworkCatalogView extends YunworkModelsView {
  readonly models: readonly TextModel[]
}

export class YunworkModels {
  private catalog: readonly TextModel[] | undefined
  private origin: string | undefined
  private failure: YunworkProblem | undefined

  /**
   * @param credentials - where the record of how the route is managed lives.
   * @param settings - the active Profile's configuration.
   * @param writes - whether the route is written at all; off, ours is taken out and the list is only read.
   * @param productName - the deployment's own name, shown as the route's `displayName`.
   */
  constructor (
    private readonly credentials: CredentialProvider,
    private readonly settings: SettingsForms,
    private readonly writes: () => boolean,
    private readonly productName: string,
  ) {}

  /** Whether the list was read since the Host started. */
  get loaded (): boolean {
    return this.catalog !== undefined
  }

  private async record (): Promise<ModelsRecord> {
    const record = await this.credentials.readRecord(MODELS_RECORD)
    const payload = record?.kind === 'grant' ? record.payload as Partial<ModelsRecord> | undefined : undefined
    return { custom: payload?.custom === true, ...(typeof payload?.written === 'string' ? { written: payload.written } : {}) }
  }

  private async saveRecord (change: Partial<ModelsRecord>): Promise<void> {
    const current = await this.record()
    const next: ModelsRecord = { ...current, ...change }
    if (next.custom === current.custom && next.written === current.written) return
    await this.credentials.modifyRecord(MODELS_RECORD, async () => ({ kind: 'grant', payload: next }))
  }

  /** Ours as the Profile stores it, and the revision it was read at. */
  private storedView (): { route: PiAiRoute | undefined; revision: number | undefined } {
    const entry = this.settings.describe({ redactSecrets: true }).find(item => item.ns === PI_AI_ENTRY)
    const providers = ((entry?.user ?? entry?.value) as { providers?: Record<string, Partial<PiAiRoute>> } | undefined)?.providers ?? {}
    const route = providers[ROUTE_ID]
    return {
      route: route === undefined || route === null || !isYunworkRoute(ROUTE_ID, route)
        ? undefined
        : { ...route, models: Array.isArray(route.models) ? route.models : [] } as PiAiRoute,
      revision: typeof entry?.revision === 'number' ? entry.revision : undefined,
    }
  }

  private plannedRoute (): PiAiRoute | undefined {
    return this.catalog === undefined || this.origin === undefined
      ? undefined
      : yunworkRoute(this.catalog, this.origin, this.productName)
  }

  /** What the page shows. */
  async view (): Promise<YunworkCatalogView> {
    const { custom } = await this.record()
    const stored = this.storedView().route
    const shown = custom ? stored : this.plannedRoute() ?? stored
    // A list that came back empty is an answer, not a pending one: without saying so the page would show a route with
    // no models and look like it was still loading.
    const empty = this.loaded && (this.catalog?.length ?? 0) === 0
    return {
      loaded: this.loaded,
      count: shown?.models.length ?? 0,
      custom,
      models: this.catalog ?? [],
      ...(this.failure !== undefined ? { error: this.failure } : empty ? { error: { code: 'no-models' as const } } : {}),
    }
  }

  /**
   * Read the list with the key, then bring the route in line with it.
   * @param apiBaseUrl - the gateway origin the route points at.
   * @param apiKey - the account's language key.
   */
  async load (apiBaseUrl: string, apiKey: string, signal: AbortSignal): Promise<void> {
    const models = await fetchTextModels({ apiBaseUrl, apiKey, signal })
    this.catalog = models
    this.origin = apiBaseUrl
    this.failure = undefined
    await this.follow()
  }

  /** Bring the route in line with what was read last, without reading the list again. */
  async apply (): Promise<void> {
    if (this.catalog === undefined) return
    await this.follow()
  }

  /** Note why the list could not be read, so the page can say it. */
  fail (error: unknown): void {
    this.failure = yunworkProblem(error)
  }

  private async follow (attempt = 0): Promise<void> {
    if (!this.writes()) {
      await this.withdraw()
      return
    }
    const record = await this.record()
    const { route: stored, revision } = this.storedView()
    let custom = record.custom
    // A route we wrote that is no longer there was deleted in Settings → Models. Deleting is a clearer statement of
    // intent than editing, so it takes the route out of our hands for good rather than being silently written back.
    if (!custom && record.written !== undefined && (stored === undefined || fingerprint(stored) !== record.written)) {
      // Edited or deleted in Settings → Models: the route is the user's from now on.
      await this.saveRecord({ custom: true })
      custom = true
    }
    if (custom) return
    const planned = this.plannedRoute()
    if (planned === undefined) throw new YunworkApiError('no-catalog')
    if (planned.models.length === 0) {
      // Nothing to offer: writing an empty route would replace a working one with one that cannot answer a request.
      await this.withdraw()
      return
    }
    try {
      await this.writeRoute(planned, revision)
      await this.saveRecord({ written: fingerprint(this.storedView().route ?? planned) })
    } catch (error) {
      if (!isConflict(error) || attempt + 1 >= MAX_CONFLICTS) throw error
      await this.follow(attempt + 1)
    }
  }

  /** Write ours into the Profile; a route already stored as it would be written costs no settings write. */
  private async writeRoute (route: PiAiRoute | undefined, revision?: number): Promise<void> {
    const present = this.storedView().route
    const value: unknown = route === undefined ? undefined : JSON.parse(JSON.stringify(route))
    if (route === undefined) {
      if (present === undefined) return
      await this.settings.mutate(PI_AI_ENTRY, [{ op: 'unset', path: ['providers', ROUTE_ID] }], revision)
      return
    }
    if (present !== undefined && stableJson(present) === stableJson(value)) return
    const ops: SettingsPathOp[] = [{ op: 'set', path: ['providers', ROUTE_ID], value }]
    await this.settings.mutate(PI_AI_ENTRY, ops, revision)
  }

  /** Take ours out of the Profile; that it is gone is then no edit of the user's. */
  private async withdraw (): Promise<void> {
    await this.writeRoute(undefined)
    const current = await this.record()
    // The fingerprint goes with the route it described. Keeping one would leave the next read comparing our own
    // withdrawal against a route the user never touched, which is the very edit this record exists to detect.
    if (current.written !== undefined) {
      await this.credentials.modifyRecord(MODELS_RECORD, async () => ({ kind: 'grant', payload: { custom: current.custom } }))
    }
  }

  /** Remove the route and forget the list and how the route was managed. */
  async clear (): Promise<void> {
    await this.writeRoute(undefined)
    await this.credentials.deleteRecord(MODELS_RECORD)
    this.catalog = undefined
    this.origin = undefined
    this.failure = undefined
  }
}
