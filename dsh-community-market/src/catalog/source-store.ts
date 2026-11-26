import { validateLocalSourceRecords } from '../contracts/validate.js'
import type { CatalogSourceStore, LocalSourceRecord } from '../contracts/types.js'
import { probeYunworkMarketContract } from '../yunwork-contract.js'
import type { MarketStateStore } from './state-store.js'

/**
 * Reconcile legacy multi-enabled registries into the single active-source
 * model. The first enabled record by user order wins. An all-disabled registry
 * keeps its explicit no-selection state.
 */
export function normalizeActiveSourceRecords(
  records: readonly LocalSourceRecord[],
): readonly LocalSourceRecord[] {
  const ordered = [...records].sort((left, right) => left.order - right.order)
  const activeSourceRecordId = ordered.find(record => record.enabled)?.sourceRecordId
  return ordered.map(record => ({
    ...record,
    enabled: record.sourceRecordId === activeSourceRecordId,
  }))
}

/**
 * The catalogue's view of market's persisted registry. Validation stays here
 * rather than at the durable boundary: the storage schema answers "is this the
 * right shape", the local-source contract answers "is this a registry market is
 * willing to act on", and only the second one is allowed to reject.
 */
export function defaultYunworkSourceRecord(): LocalSourceRecord | undefined {
  const contract = probeYunworkMarketContract()
  if (contract.manifestUrl === undefined) return undefined
  const origin = new URL(contract.manifestUrl).origin
  return {
    sourceRecordId: '00000000-0000-4000-8000-000000000001',
    providerId: 'com.yundashi.plugins',
    adapterId: 'market.standard-http-v1',
    registrationKind: 'user-added',
    manifestUrl: contract.manifestUrl,
    manifest: {
      manifestVersion: '1.0.0',
      providerId: 'com.yundashi.plugins',
      name: `${contract.displayName}插件市场`,
      attribution: { name: contract.displayName, url: origin },
      transport: {
        kind: 'https-json',
        method: 'GET',
        endpoint: `${origin}/api/v2/plugins/v1/plugins`,
      },
      query: {
        supported: ['q', 'category', 'cursor', 'limit'],
        sorts: [],
        defaultLimit: 20,
        maxLimit: 50,
      },
    },
    enabled: true,
    order: 0,
  }
}

export class PersistentCatalogSourceStore implements CatalogSourceStore {
  private defaultSeeded = false

  constructor(
    private readonly state: MarketStateStore,
    private readonly defaultSourceRecord: () => LocalSourceRecord | undefined = defaultYunworkSourceRecord,
  ) {}

  async load(): Promise<readonly LocalSourceRecord[]> {
    const records = [...this.state.getSources()]
    if (!this.defaultSeeded && records.length === 0 && !(this.state.hasSourcesWritten?.() ?? false)) {
      this.defaultSeeded = true
      const seeded = this.defaultSourceRecord()
      if (seeded !== undefined) {
        validateLocalSourceRecords([seeded])
        await this.state.setSources([seeded])
        return [seeded]
      }
    } else if (records.length > 0) {
      this.defaultSeeded = true
      const contractUrl = probeYunworkMarketContract().manifestUrl
      let migratedAny = false
const DEFAULT_YUNWORK_SOURCE_RECORD_ID = '00000000-0000-4000-8000-000000000001'

function rewriteEndpointOrigin(endpoint: string, targetOrigin: string): string {
  try {
    const parsed = new URL(endpoint)
    return `${targetOrigin}${parsed.pathname}${parsed.search}`
  } catch {
    return endpoint
  }
}

      const migrated = records.map(record => {
        if (record.sourceRecordId !== DEFAULT_YUNWORK_SOURCE_RECORD_ID || contractUrl === undefined) return record
        const targetOrigin = new URL(contractUrl).origin
        const nextManifest = record.manifest === undefined
          ? undefined
          : {
              ...record.manifest,
              providerId: 'com.yundashi.plugins',
              attribution: { ...record.manifest.attribution, url: targetOrigin },
              transport: {
                ...record.manifest.transport,
                endpoint: rewriteEndpointOrigin(record.manifest.transport.endpoint, targetOrigin),
              },
            }
        const manifestChanged = record.manifest !== undefined && nextManifest !== undefined && (
          record.manifest.providerId !== nextManifest.providerId
          || record.manifest.attribution.url !== nextManifest.attribution.url
          || record.manifest.transport.endpoint !== nextManifest.transport.endpoint
        )
        const urlChanged = record.manifestUrl !== contractUrl
        const idChanged = record.providerId !== 'com.yundashi.plugins'
        if (!urlChanged && !idChanged && !manifestChanged) return record
        migratedAny = true
        return {
          ...record,
          providerId: 'com.yundashi.plugins',
          manifestUrl: contractUrl,
          ...(nextManifest === undefined ? {} : { manifest: nextManifest }),
        }
      })
      if (migratedAny) {
        validateLocalSourceRecords(migrated)
        await this.state.setSources(migrated)
        return normalizeActiveSourceRecords(migrated)
      }
    }
    validateLocalSourceRecords(records)
    return normalizeActiveSourceRecords(records)
  }

  async save(records: readonly LocalSourceRecord[]): Promise<void> {
    const normalized = normalizeActiveSourceRecords(records)
    validateLocalSourceRecords(normalized)
    await this.state.setSources(normalized)
  }
}

export class MemoryCatalogSourceStore implements CatalogSourceStore {
  private records: readonly LocalSourceRecord[] = []

  async load(): Promise<readonly LocalSourceRecord[]> {
    return this.records
  }

  async save(records: readonly LocalSourceRecord[]): Promise<void> {
    const normalized = normalizeActiveSourceRecords(records)
    validateLocalSourceRecords(normalized)
    this.records = normalized.map(record => ({ ...record }))
  }
}
