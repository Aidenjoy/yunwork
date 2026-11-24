/**
 * The parts of the Host face that carry a contract with the outside world: which origin a request goes to, which URL
 * the browser gets, and what a stored route looks like.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  RUNTIME_FILENAME, RUNTIME_VARIABLE, YunworkConfigError, loadRuntimeConfig, parseRuntimeFile, readRuntimeContract,
  resolveRuntimePath,
} from '../src/host/env-config.ts'
import {
  DESKTOP_CALLBACK_PATH, DESKTOP_CLIENT_ID, desktopAuthorizeUrl, desktopRedirectUri, desktopToken,
} from '../src/host/api-client.ts'
import { collectDiagnostics, profileFacts } from '../src/host/diagnostics.ts'
import { ROUTE_ID, YunworkModels, isYunworkRoute, stableJson, yunworkRoute } from '../src/host/models.ts'
import { YUNWORK_API_KEY_REF, YUNWORK_ROUTES } from '../src/shared.ts'

const ORIGINS = { YUNWORK_API_BASE_URL: 'https://token.yundashi.com', YUNWORK_AUTH_BASE_URL: 'https://token.yundashi.com' }

describe('loadRuntimeConfig', () => {
  it('reads the origins the process environment gives and normalises a trailing slash', () => {
    const config = loadRuntimeConfig({ environment: { ...ORIGINS, YUNWORK_API_BASE_URL: 'https://token.yundashi.com/' } })
    expect(config.apiBaseUrl).toBe('https://token.yundashi.com')
    expect(config.authBaseUrl).toBe('https://token.yundashi.com')
    expect(config.productName).toBe('云大师 Agent')
    expect(config.env).toBe('prod')
  })

  it('refuses to fall back to a production origin when none is configured', () => {
    expect(() => loadRuntimeConfig({ environment: {} })).toThrow(YunworkConfigError)
    expect(() => loadRuntimeConfig({ environment: {} })).toThrow(/No apiBaseUrl or authBaseUrl configured/u)
  })

  it('rejects plain http unless the deployment says it is insecure', () => {
    const local = { YUNWORK_API_BASE_URL: 'http://127.0.0.1:3000', YUNWORK_AUTH_BASE_URL: 'http://127.0.0.1:3000' }
    expect(() => loadRuntimeConfig({ environment: local })).toThrow(/plain http but insecure is not set/u)
    expect(loadRuntimeConfig({ environment: { ...local, YUNWORK_INSECURE: 'true' } }).insecure).toBe(true)
  })

  it('lets the plugin Config win over the environment', () => {
    const config = loadRuntimeConfig({ environment: ORIGINS, overrides: { apiBaseUrl: 'https://gateway.example.test' } })
    expect(config.apiBaseUrl).toBe('https://gateway.example.test')
    expect(config.authBaseUrl).toBe('https://token.yundashi.com')
  })

  it('rejects a runtime file from another generation and says how to regenerate it', () => {
    expect(() => parseRuntimeFile({ version: 2 }, '/tmp/runtime.json')).toThrow(/runtime version 2/u)
    expect(() => parseRuntimeFile({ version: 1 }, '/tmp/runtime.json')).toThrow(/not a valid runtime file/u)
  })

  it('accepts exactly the sixteen contract keys and refuses a seventeenth', () => {
    const contract = {
      version: 1, productName: 'p', shortName: 's', tagline: 't', appId: 'com.yundashi.agent', dataDirName: '.yundashi',
      defaultLocale: 'zh-CN', brandColor: '#fff', backgroundColor: '#fff', themeColor: '#fff', artifactPrefix: 'a',
      apiBaseUrl: 'https://x.test', authBaseUrl: 'https://x.test', insecure: false, updateFeedUrl: null, env: 'dev',
    }
    expect(Object.keys(contract)).toHaveLength(16)
    expect(parseRuntimeFile(contract, '/tmp/runtime.json').tagline).toBe('t')
    // `profileKey` is pinned on the Host side and never published to the plugin.
    expect(() => parseRuntimeFile({ ...contract, profileKey: 'yundashi' }, '/tmp/runtime.json')).toThrow(/not a valid runtime file/u)
  })
})

describe('readRuntimeContract', () => {
  it('reports no source when the process names no runtime file', () => {
    expect(readRuntimeContract({})).toEqual({ path: null, present: false, version: null, value: undefined })
  })

  it('reports the declared version of a file this build cannot read, so a diagnosis can still answer', () => {
    const directory = mkdtempSync(join(tmpdir(), 'yunwork-contract-'))
    const file = join(directory, 'yunwork-runtime.json')
    writeFileSync(file, JSON.stringify({ version: 7, env: 'test' }), 'utf8')
    const source = readRuntimeContract({ [RUNTIME_VARIABLE]: file })
    expect(source).toMatchObject({ path: file, present: true, version: 7 })
    expect(() => loadRuntimeConfig({ environment: { [RUNTIME_VARIABLE]: file } })).toThrow(/runtime version 7/u)
  })

  it('reports a file the process names but that is not there', () => {
    const source = readRuntimeContract({ [RUNTIME_VARIABLE]: join(tmpdir(), 'definitely-absent', 'runtime.json') })
    expect(source).toMatchObject({ present: false, version: null })
  })
})

describe('diagnostics', () => {
  it('reads the launcher profile facts and never assembles a path of its own', () => {
    expect(profileFacts({})).toBeUndefined()
    expect(profileFacts({ profileContext: { dir: '/data/profiles/yundashi', home: '/data', name: 'yundashi', patchPath: '/data/profiles/yundashi/cordis.patch.yml' } }))
      .toEqual({ dir: '/data/profiles/yundashi', home: '/data', name: 'yundashi', patchPath: '/data/profiles/yundashi/cordis.patch.yml' })
  })

  it('answers with the contract, the profile, the credential and the route', async () => {
    const report = await collectDiagnostics({
      ctx: { profileContext: { dir: '/data/profiles/yundashi', home: '/data', name: 'yundashi', patchPath: '/p' } },
      credentials: { describeRecord: async () => ({ configured: true, kind: 'grant', writable: true }) } as never,
      settings: { describe: () => [{ ns: 'llm-pi-ai', revision: 4, user: { providers: { [ROUTE_ID]: { apiKeyEnv: YUNWORK_API_KEY_REF } } } }] } as never,
      environment: {},
    })
    expect(report.contract).toMatchObject({ source: null, present: false, version: null, expectedVersion: 1, incompatible: false })
    expect(report.profile).toEqual({ dir: '/data/profiles/yundashi', name: 'yundashi', patchPath: '/p', home: '/data' })
    expect(report.credential).toEqual({ key: 'yunwork/grant', present: true, kind: 'grant', writable: true })
    expect(report.models).toEqual({ revision: 4, hasYunworkProvider: true, route: ROUTE_ID })
  })

  it('marks an unreadable generation incompatible instead of failing', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'yunwork-incompatible-'))
    const file = join(directory, 'yunwork-runtime.json')
    writeFileSync(file, JSON.stringify({ version: 3, env: 'dev' }), 'utf8')
    const report = await collectDiagnostics({
      ctx: {},
      credentials: { describeRecord: async () => { throw new Error('store unavailable') } } as never,
      settings: { describe: () => [] } as never,
      environment: { [RUNTIME_VARIABLE]: file },
    })
    expect(report.contract).toMatchObject({ version: 3, expectedVersion: 1, incompatible: true, env: 'dev' })
    expect(report.profile).toEqual({ dir: null, name: null, patchPath: null, home: null })
    expect(report.credential.present).toBe(false)
    expect(report.models).toEqual({ revision: null, hasYunworkProvider: false, route: ROUTE_ID })
  })

  it('is reachable only under /api, the single prefix the Host transport owns', () => {
    expect(YUNWORK_ROUTES.diagnostics.startsWith('/api/')).toBe(true)
  })
})

describe('desktopAuthorizeUrl', () => {
  it('carries the desktop client, the loopback redirect and an S256 challenge', () => {
    const url = new URL(desktopAuthorizeUrl('https://token.yundashi.com', {
      redirectUri: 'http://127.0.0.1:49152/desktop-auth/callback', state: 'state-value', challenge: 'challenge-value',
    }))
    expect(url.pathname).toBe('/api/desktop-auth/authorize')
    expect(url.searchParams.get('client_id')).toBe(DESKTOP_CLIENT_ID)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('redirect_uri')).toBe(`http://127.0.0.1:49152${DESKTOP_CALLBACK_PATH}`)
  })

  it('builds the only redirect shape the server accepts', () => {
    expect(desktopRedirectUri(49152)).toBe('http://127.0.0.1:49152/desktop-auth/callback')
  })
})

describe('desktopToken', () => {
  const valid = {
    access_token: 'a'.repeat(43), token_type: 'Bearer', expires_in: 3600, language_api_key: 'sk-abc123',
  }

  it('accepts the documented exchange response, with or without a user', () => {
    expect(desktopToken.safeParse(valid).success).toBe(true)
    expect(desktopToken.safeParse({ ...valid, user: { id: 1, username: 'u', display_name: '', role: 1, group: 'default' } }).success).toBe(true)
  })

  it('rejects a key that is not the language key, and degrades a drifted user to none', () => {
    expect(desktopToken.safeParse({ ...valid, language_api_key: 'not-a-key' }).success).toBe(false)
    expect(desktopToken.safeParse({ ...valid, token_type: 'bearer' }).success).toBe(false)
    const drifted = desktopToken.parse({ ...valid, user: { unexpected: true } })
    expect(drifted.user).toBeUndefined()
  })
})

describe('yunworkRoute', () => {
  const route = yunworkRoute([{ id: 'sample-model', name: 'Sample Model' }], 'https://token.yundashi.com/', '云大师 Agent')

  it('speaks openai-completions at /v1', () => {
    expect(route.api).toBe('openai-completions')
    expect(route.baseURL).toBe('https://token.yundashi.com/v1')
    expect(route.apiKeyEnv).toBe(YUNWORK_API_KEY_REF)
  })

  it('declares no capability the listing never gave, including input modalities', () => {
    expect(route.models[0]).toEqual({ id: 'sample-model', name: 'Sample Model' })
  })

  it('names the route after the deployment, not after a hard-coded brand', () => {
    expect(route.displayName).toBe('云大师 Agent (Utoken)')
  })

  it('recognises only its own route, never another plugin\'s', () => {
    expect(isYunworkRoute(ROUTE_ID, route)).toBe(true)
    expect(isYunworkRoute('tokens-anywhere', route)).toBe(false)
    expect(isYunworkRoute(ROUTE_ID, { ...route, apiKeyEnv: 'OTHER_KEY' })).toBe(false)
  })

  it('fingerprints irrespective of key order', () => {
    expect(stableJson({ a: 1, b: 2 })).toBe(stableJson({ b: 2, a: 1 }))
  })
})

describe('where the runtime contract is found', () => {
  /** A complete contract, so a probe that succeeds also resolves. */
  const CONTRACT = {
    version: 1, productName: '云大师 Agent', shortName: '云大师', tagline: 't', appId: 'com.yundashi.agent',
    dataDirName: '.yundashi', defaultLocale: 'zh-CN', brandColor: '#fff', backgroundColor: '#fff', themeColor: '#fff',
    artifactPrefix: 'a', apiBaseUrl: 'https://token.yundashi.com', authBaseUrl: 'https://token.yundashi.com',
    insecure: false, updateFeedUrl: null, env: 'prod',
  }

  function staging (): string {
    return mkdtempSync(join(tmpdir(), 'yunwork-probe-'))
  }

  function place (directory: string): string {
    mkdirSync(directory, { recursive: true })
    const path = join(directory, RUNTIME_FILENAME)
    writeFileSync(path, JSON.stringify(CONTRACT))
    return path
  }

  it('lets nothing be installed and still reports where it would have looked', () => {
    // The packaged case with no file: the plugin degrades instead of inventing an origin.
    expect(resolveRuntimePath({}, { resourcesPath: '', execPath: '' })).toEqual({ path: null, explicit: false })
    expect(readRuntimeContract({}, { resourcesPath: '', execPath: '' }))
      .toEqual({ path: null, present: false, version: null, value: undefined })
    expect(() => loadRuntimeConfig({ environment: {}, platform: { resourcesPath: '', execPath: '' }, overrides: {} }))
      .toThrow(/No apiBaseUrl or authBaseUrl configured/u)
  })

  it('finds the copy a packaged app carries in its resources directory', () => {
    const resourcesPath = staging()
    const path = place(resourcesPath)
    expect(resolveRuntimePath({}, { resourcesPath })).toEqual({ path, explicit: false })
    const config = loadRuntimeConfig({ environment: {}, platform: { resourcesPath }, overrides: {} })
    expect(config.productName).toBe('云大师 Agent')
    expect(config.apiBaseUrl).toBe('https://token.yundashi.com')
    expect(readRuntimeContract({}, { resourcesPath }).path).toBe(path)
  })

  it('finds the unpacked copy a plain Node Host can read beside the archive', () => {
    // The Host is a separate process: a file only inside `app.asar` is invisible to it, so the packaged build also
    // ships the contract through `asarUnpack`, and the probe has to reach that copy.
    const resourcesPath = staging()
    const path = place(join(resourcesPath, 'app.asar.unpacked'))
    expect(resolveRuntimePath({}, { resourcesPath })).toEqual({ path, explicit: false })
    expect(loadRuntimeConfig({ environment: {}, platform: { resourcesPath }, overrides: {} }).productName)
      .toBe('云大师 Agent')
  })

  it('finds the file beside the executable when the app names no resources directory', () => {
    const executable = join(staging(), 'bin', 'app.exe')
    const path = place(join(dirname(executable), 'resources'))
    expect(resolveRuntimePath({}, { execPath: executable })).toEqual({ path, explicit: false })
    expect(loadRuntimeConfig({ environment: {}, platform: { execPath: executable }, overrides: {} }).authBaseUrl)
      .toBe('https://token.yundashi.com')
  })

  it('obeys a named file even when it is absent, rather than silently reading another one', () => {
    // A launcher that pinned a path meant it; falling back would hide exactly the mismatch the pin exists to expose.
    const resourcesPath = staging()
    place(resourcesPath)
    const named = join(staging(), 'absent.json')
    expect(resolveRuntimePath({ [RUNTIME_VARIABLE]: named }, { resourcesPath })).toEqual({ path: named, explicit: true })
    expect(readRuntimeContract({ [RUNTIME_VARIABLE]: named }, { resourcesPath }))
      .toEqual({ path: named, present: false, version: null, value: undefined })
    expect(() => loadRuntimeConfig({ environment: { [RUNTIME_VARIABLE]: named }, platform: { resourcesPath }, overrides: {} }))
      .toThrow(/which does not exist/u)
  })

  it('prefers the named file over the packaged copy', () => {
    const resourcesPath = staging()
    place(resourcesPath)
    const pinned = join(staging(), 'pinned.json')
    writeFileSync(pinned, JSON.stringify({ ...CONTRACT, apiBaseUrl: 'https://pinned.example.test', authBaseUrl: 'https://pinned.example.test' }))
    expect(loadRuntimeConfig({ environment: { [RUNTIME_VARIABLE]: pinned }, platform: { resourcesPath }, overrides: {} }).apiBaseUrl)
      .toBe('https://pinned.example.test')
  })
})

describe('the route the plugin manages', () => {
  /** One record and one settings namespace, in memory: enough for the ownership rules to run against. */
  function harness (): {
    credentials: never
    settings: never
    route: () => unknown
    record: () => { custom?: boolean; written?: string } | undefined
    deleteRoute: () => void
  } {
    let route: unknown
    let record: { custom?: boolean; written?: string } | undefined
    let revision = 1
    const credentials = {
      readRecord: async () => record === undefined ? undefined : { kind: 'grant', payload: record },
      modifyRecord: async (_name: unknown, update: () => Promise<{ payload: unknown }>) => { record = (await update()).payload as typeof record },
      deleteRecord: async () => { record = undefined },
      describeRecord: async () => ({ configured: record !== undefined, writable: true }),
    }
    const settings = {
      describe: () => [{
        ns: 'llm-pi-ai',
        value: undefined,
        user: route === undefined ? { providers: {} } : { providers: { [ROUTE_ID]: route } },
        revision,
      }],
      mutate: async (_ns: string, ops: readonly { op: string; value?: unknown }[]) => {
        for (const op of ops) route = op.op === 'unset' ? undefined : op.value
        revision += 1
      },
    }
    return {
      credentials: credentials as never,
      settings: settings as never,
      route: () => route,
      record: () => record,
      // What Settings → Models does: the route is gone, and the revision moved with it.
      deleteRoute: () => { route = undefined; revision += 1 },
    }
  }

  /** The listing the gateway would return, so `load` can run without a network. */
  function serveListing (): void {
    vi.stubGlobal('fetch', async () => new Response(
      JSON.stringify({ data: [{ id: 'sample-model', name: 'Sample Model' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
  }

  afterEach(() => { vi.unstubAllGlobals() })

  it('takes its route out and forgets the fingerprint when writing is turned off', async () => {
    // Before this, `withdraw` fingerprinted `undefined`, which `createHash.update` rejects: the route was removed and
    // the promise still rejected, so the page showed a failure on a write that had in fact succeeded.
    serveListing()
    const state = harness()
    let writes = true
    const models = new YunworkModels(state.credentials, state.settings, () => writes, '云大师 Agent')
    const signal = new AbortController().signal
    await models.load('https://token.yundashi.com', 'sk-test', signal)
    expect(state.route()).toBeDefined()

    writes = false
    await expect(models.apply()).resolves.toBeUndefined()
    expect(state.route()).toBeUndefined()
    // The fingerprint described the route it belonged to, so it went with it; keeping one would read as a user edit.
    expect(state.record()).toEqual({ custom: false })
  })

  it('does not write its route back after the user deletes it', async () => {
    // Deleting is a clearer statement of intent than editing, so the route belongs to the user afterwards.
    serveListing()
    const state = harness()
    const models = new YunworkModels(state.credentials, state.settings, () => true, '云大师 Agent')
    await models.load('https://token.yundashi.com', 'sk-test', new AbortController().signal)
    expect(state.route()).toBeDefined()

    state.deleteRoute()
    await models.apply()
    expect(state.route()).toBeUndefined()
    expect(state.record()?.custom).toBe(true)
  })
})
