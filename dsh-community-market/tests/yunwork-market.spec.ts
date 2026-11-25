import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { standardHttpAdapter } from '../src/adapters/standard-http.js'
import { parseCatalogSource } from '../src/contracts/validate.js'
import { PersistentCatalogSourceStore } from '../src/catalog/source-store.js'
import { DeferredMarketStateStore } from '../src/catalog/state-store.js'
import type { CatalogHttpClient, CatalogMediaRegistry, LocalSourceRecord } from '../src/contracts/types.js'
import { createRestrictedHttpClient } from '../src/network/restricted-http.js'

const tempDirs: string[] = []

afterEach(() => {
  delete process.env['YUNWORK_RUNTIME']
  delete process.env['YUNWORK_MARKET_MANIFEST_URL']
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function createTestRuntime(content: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'yunwork-market-test-'))
  tempDirs.push(dir)
  const file = join(dir, 'yunwork-runtime.json')
  writeFileSync(file, JSON.stringify(content), 'utf8')
  process.env['YUNWORK_RUNTIME'] = file
  return file
}

const noopMedia: CatalogMediaRegistry = {
  register: () => 'asset://noop',
  unregisterSource: () => {},
}

describe('yunwork community market integration', () => {
  it('seeds default source only when registry is empty and never overwrites user sources', async () => {
    createTestRuntime({
      anywhereServerUrl: 'http://192.168.110.152:5174',
      insecure: true,
    })
    const state = new DeferredMarketStateStore(() => {})
    const store = new PersistentCatalogSourceStore(state)

    const initial = await store.load()
    expect(initial).toHaveLength(1)
    expect(initial[0]?.manifestUrl).toBe('http://192.168.110.152:5174/api/v2/plugins/config')
    expect(initial[0]?.enabled).toBe(true)

    const userSource: LocalSourceRecord = {
      sourceRecordId: '00000000-0000-4000-8000-000000000002',
      providerId: 'custom-provider',
      adapterId: 'market.standard-http-v1',
      registrationKind: 'user-added',
      manifestUrl: 'https://plugins.example.com/config.json',
      manifest: {
        manifestVersion: '1.0.0',
        providerId: 'custom-provider',
        name: 'Custom',
        attribution: { name: 'Custom', url: 'https://plugins.example.com' },
        transport: { kind: 'https-json', method: 'GET', endpoint: 'https://plugins.example.com/v1/plugins' },
        query: { supported: ['q'], sorts: [], defaultLimit: 20, maxLimit: 50 },
      },
      enabled: true,
      order: 0,
    }
    await store.save([userSource])
    const reloaded = await store.load()
    expect(reloaded).toHaveLength(1)
    expect(reloaded[0]?.sourceRecordId).toBe('00000000-0000-4000-8000-000000000002')
  })

  it('fetches manifest, queries with q/category/nextCursor, and reflects publish/unpublish on refresh', async () => {
    createTestRuntime({
      anywhereServerUrl: 'http://192.168.110.152:5174',
      insecure: true,
    })

    let published = [
      {
        id: 'plugin-a',
        name: 'plugin-a',
        displayName: 'Plugin A',
        latestVersion: '1.0.0',
        summary: 'First plugin',
        categories: ['tools'],
        package: { registry: 'npm', name: '@yunwork/plugin-a' },
      },
      {
        id: 'plugin-b',
        name: 'plugin-b',
        displayName: 'Plugin B',
        latestVersion: '1.0.0',
        summary: 'Second plugin',
        categories: ['productivity'],
        package: { registry: 'npm', name: '@yunwork/plugin-b' },
      },
    ]

    const requestedUrls: string[] = []
    const mockHttp: CatalogHttpClient = {
      async getJson(url) {
        requestedUrls.push(url)
        if (url.endsWith('/api/v2/plugins/config')) {
          return {
            finalUrl: url,
            value: {
              manifestVersion: '1.0.0',
              providerId: 'yuncontrol-plugins',
              name: '云大师插件市场',
              attribution: { name: '云大师', url: 'https://plugins.yunwork.test' },
              transport: {
                kind: 'https-json',
                method: 'GET',
                endpoint: 'https://plugins.yunwork.test/api/v2/plugins/v1/plugins',
              },
              query: {
                supported: ['q', 'category', 'cursor', 'limit'],
                sorts: [],
                defaultLimit: 20,
                maxLimit: 50,
              },
            },
          }
        }
        const parsed = new URL(url)
        const q = parsed.searchParams.get('q') ?? ''
        const categories = parsed.searchParams.getAll('category')
        const cursor = parsed.searchParams.get('cursor')
        const filtered = published.filter(item =>
          (q === '' || item.displayName.includes(q))
          && (categories.length === 0 || categories.some(c => item.categories.includes(c))),
        )
        const pageItems = cursor === 'page2' ? filtered.slice(1, 2) : filtered.slice(0, 1)
        const nextCursor = cursor === null && filtered.length > 1 ? 'page2' : null
        return {
          finalUrl: url,
          value: {
            schemaVersion: '1.0.0',
            revision: `rev-${published.length}`,
            items: pageItems,
            page: nextCursor === null ? {} : { nextCursor },
          },
        }
      },
    }

    const source: LocalSourceRecord = {
      sourceRecordId: '00000000-0000-4000-8000-000000000001',
      providerId: 'yuncontrol-plugins',
      adapterId: 'market.standard-http-v1',
      registrationKind: 'user-added',
      manifestUrl: 'https://plugins.yunwork.test/api/v2/plugins/config',
      enabled: true,
      order: 0,
    }

    const page1 = await standardHttpAdapter.fetch({ q: 'Plugin', category: ['tools', 'productivity'], limit: 1 }, {
      source,
      http: mockHttp,
      media: noopMedia,
      signal: new AbortController().signal,
    })
    expect(page1.items).toHaveLength(1)
    expect(page1.page.nextCursor).toBe('page2')
    expect(requestedUrls.some(u => u.includes('category=tools&category=productivity'))).toBe(true)

    const page2 = await standardHttpAdapter.fetch({ cursor: 'page2', limit: 1 }, {
      source,
      http: mockHttp,
      media: noopMedia,
      signal: new AbortController().signal,
    })
    expect(page2.items).toHaveLength(1)
    expect(page2.page.nextCursor).toBeUndefined()

    // Unpublish plugin-b and refresh
    published = [published[0]!]
    const refreshed = await standardHttpAdapter.fetch({}, {
      source,
      http: mockHttp,
      media: noopMedia,
      signal: new AbortController().signal,
    })
    expect(refreshed.items.map(i => i.id)).toEqual(['plugin-a'])
  })

  it('strictly blocks http:// and private IPs when insecure is false', async () => {
    createTestRuntime({
      anywhereServerUrl: 'http://192.168.110.152:5174',
      insecure: false,
    })
    const client = createRestrictedHttpClient()
    await expect(
      client.getJson('http://192.168.110.152:5174/api/v2/plugins/config', new AbortController().signal),
    ).rejects.toThrow()
  })
})

  it('allows http:// + port in parseCatalogSource only when insecureOrigin matches, and migrates legacy providerId', async () => {
    const lanManifest = {
      manifestVersion: '1.0.0',
      providerId: 'com.yundashi.plugins',
      name: '云大师',
      attribution: { name: '云大师', url: 'http://192.168.110.152:5174/' },
      transport: {
        kind: 'https-json',
        endpoint: 'http://192.168.110.152:5174/api/v2/plugins/v1/plugins',
        method: 'GET',
      },
      query: { supported: ['q', 'category', 'cursor', 'limit'], defaultLimit: 50, maxLimit: 100, sorts: [] },
    }
    expect(() => parseCatalogSource(lanManifest)).toThrow()
    expect(() => parseCatalogSource(lanManifest, 'http://other.local:5174')).toThrow()
    expect(parseCatalogSource(lanManifest, 'http://192.168.110.152:5174').providerId).toBe('com.yundashi.plugins')

    createTestRuntime({
      anywhereServerUrl: 'http://192.168.110.152:5174',
      insecure: true,
    })
    const state = new DeferredMarketStateStore(() => {})
    await state.setSources([{
      sourceRecordId: '00000000-0000-4000-8000-000000000001',
      providerId: 'yuncontrol-plugins',
      adapterId: 'market.standard-http-v1',
      registrationKind: 'user-added',
      manifestUrl: 'http://192.168.110.152:5174/api/v2/plugins/config',
      manifest: { ...lanManifest, providerId: 'yuncontrol-plugins' } as never,
      enabled: true,
      order: 0,
    }])
    const store = new PersistentCatalogSourceStore(state)
    const migrated = await store.load()
    expect(migrated[0]?.providerId).toBe('com.yundashi.plugins')
  })
