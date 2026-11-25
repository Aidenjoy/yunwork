import type { ValidateFunction } from 'ajv'
import { probeYunworkMarketContract } from '../yunwork-contract.js'
import { CatalogContractError, schemaIssues, semanticIssue, type CatalogContractName } from './errors.js'
import type { CatalogProviderPage } from './generated/catalog-provider-page.js'
import type { CatalogQuery } from './generated/catalog-query.js'
import type { CatalogSnapshot } from './generated/catalog-snapshot.js'
import type { CatalogSourceManifest } from './generated/catalog-source.js'
import { normalizeGitHubInstallSource, normalizeRepositoryIdentity } from './identity.js'
import { validators } from './schemas.js'
import type { LocalSourceRecord } from './types.js'

function parseSchema<T>(contract: CatalogContractName, validate: ValidateFunction<T>, value: unknown): T {
  if (!validate(value)) {
    throw new CatalogContractError(contract, schemaIssues(validate.errors))
  }
  return value
}

function normalizeInsecureSourceForSchema(value: unknown, insecureOrigin?: string): unknown {
  if (insecureOrigin === undefined || typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value
  }
  const obj = value as Record<string, unknown>
  const rewrite = (raw: unknown): unknown => {
    if (typeof raw !== 'string') return raw
    try {
      const u = new URL(raw)
      if (u.protocol === 'http:' && u.origin === insecureOrigin && !u.username && !u.password && !u.hash) {
        return `https://insecure-origin.local${u.pathname}${u.search}`
      }
    } catch {
      // Keep original so Ajv reports the invalid URL.
    }
    return raw
  }
  const attr = typeof obj['attribution'] === 'object' && obj['attribution'] !== null && !Array.isArray(obj['attribution'])
    ? { ...(obj['attribution'] as Record<string, unknown>), url: rewrite((obj['attribution'] as Record<string, unknown>)['url']) }
    : obj['attribution']
  const transport = typeof obj['transport'] === 'object' && obj['transport'] !== null && !Array.isArray(obj['transport'])
    ? { ...(obj['transport'] as Record<string, unknown>), endpoint: rewrite((obj['transport'] as Record<string, unknown>)['endpoint']) }
    : obj['transport']
  return { ...obj, attribution: attr, transport }
}

export function parseCatalogSource(
  value: unknown,
  insecureOrigin = probeYunworkMarketContract().insecureOrigin,
): CatalogSourceManifest {
  const normalized = normalizeInsecureSourceForSchema(value, insecureOrigin)
  parseSchema('source', validators.source, normalized)
  const source = value as CatalogSourceManifest
  const issues = []
  const endpoint = new URL(source.transport.endpoint)
  const allowInsecure = insecureOrigin !== undefined && endpoint.origin === insecureOrigin

  if (
    (!allowInsecure && (endpoint.protocol !== 'https:' || endpoint.port))
    || (allowInsecure && endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:')
    || endpoint.username
    || endpoint.password
    || endpoint.search
    || endpoint.hash
    || !endpoint.pathname.endsWith('/v1/plugins')
  ) {
    issues.push(semanticIssue('/transport/endpoint', 'must use credential-free HTTPS on standard port 443 without query or fragment and end in /v1/plugins'))
  }
  if (source.query.defaultLimit > source.query.maxLimit) {
    issues.push(semanticIssue('/query/defaultLimit', 'must not exceed maxLimit'))
  }
  if (source.query.supported.includes('sort') && source.query.sorts.length === 0) {
    issues.push(semanticIssue('/query/sorts', 'must not be empty when sort is supported'))
  }
  if (!source.query.supported.includes('sort') && source.query.sorts.length > 0) {
    issues.push(semanticIssue('/query/sorts', 'must be empty when sort is not supported'))
  }

  if (issues.length) throw new CatalogContractError('source', issues)
  return source
}

export function parseCatalogQuery(value: unknown): CatalogQuery {
  return parseSchema('query', validators.query, value)
}

export function parseCatalogProviderPage(value: unknown, effectiveLimit?: number): CatalogProviderPage {
  const page = parseSchema('provider-page', validators.providerPage, value)
  const seen = new Set<string>()

  if (effectiveLimit !== undefined) {
    if (!Number.isInteger(effectiveLimit) || effectiveLimit < 1 || effectiveLimit > 100) {
      throw new CatalogContractError('provider-page', [
        semanticIssue('/items', 'cannot be checked against an invalid effective query limit'),
      ])
    }
    if (page.items.length > effectiveLimit) {
      throw new CatalogContractError('provider-page', [
        semanticIssue('/items', `contains more than the effective query limit of ${effectiveLimit}`),
      ])
    }
  }

  for (const [index, item] of page.items.entries()) {
    if (seen.has(item.id)) {
      throw new CatalogContractError('provider-page', [
        semanticIssue(`/items/${index}/id`, `duplicates provider item ID ${item.id}`),
      ])
    }
    seen.add(item.id)
    if (item.repository) normalizeRepositoryIdentity(item.repository)
    if (item.installSource) normalizeGitHubInstallSource(item.repository, item.installSource)
  }

  return page
}

export function parseCatalogSnapshot(
  value: unknown,
  insecureOrigin = probeYunworkMarketContract().insecureOrigin,
): CatalogSnapshot {
  let normalized = value
  if (insecureOrigin !== undefined && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    const src = obj['source']
    if (typeof src === 'object' && src !== null && !Array.isArray(src)) {
      const finalUrl = (src as Record<string, unknown>)['finalUrl']
      if (typeof finalUrl === 'string') {
        try {
          const u = new URL(finalUrl)
          if (u.protocol === 'http:' && u.origin === insecureOrigin && !u.username && !u.password && !u.hash) {
            normalized = { ...obj, source: { ...(src as Record<string, unknown>), finalUrl: `https://insecure-origin.local${u.pathname}${u.search}` } }
          }
        } catch {
          // Keep original so Ajv reports invalid URL.
        }
      }
    }
  }
  parseSchema('snapshot', validators.snapshot, normalized)
  const snapshot = value as CatalogSnapshot
  const seen = new Set<string>()

  for (const [index, item] of snapshot.items.entries()) {
    const path = `/items/${index}`
    if (
      item.provenance.sourceRecordId !== snapshot.source.sourceRecordId
      || item.provenance.providerId !== snapshot.source.providerId
      || item.provenance.itemId !== item.id
    ) {
      throw new CatalogContractError('snapshot', [
        semanticIssue(`${path}/provenance`, 'must match the snapshot source and item ID'),
      ])
    }

    const identity = `${item.provenance.sourceRecordId}\0${item.provenance.itemId}`
    if (seen.has(identity)) {
      throw new CatalogContractError('snapshot', [
        semanticIssue(`${path}/provenance`, 'duplicates a normalized source/item identity'),
      ])
    }
    seen.add(identity)
    if (item.repository) normalizeRepositoryIdentity(item.repository)
    if (item.installSource) normalizeGitHubInstallSource(item.repository, item.installSource)
  }

  return snapshot
}

export function validateLocalSourceRecords(records: readonly LocalSourceRecord[]): void {
  const ids = new Set<string>()
  const orders = new Set<number>()
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
  const providerIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/u
  const adapterIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/u
  const builtInKeyPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u

  for (const [index, record] of records.entries()) {
    const hasManifest = record.manifestUrl !== undefined
    const hasBuiltIn = record.builtInProviderKey !== undefined
    if (hasManifest === hasBuiltIn) {
      throw new CatalogContractError('local-source', [
        semanticIssue(`/${index}`, 'must contain exactly one of manifestUrl or builtInProviderKey'),
      ])
    }
    if (record.registrationKind === 'user-added' && !hasManifest) {
      throw new CatalogContractError('local-source', [
        semanticIssue(`/${index}/manifestUrl`, 'is required for a user-added source'),
      ])
    }
    if (record.registrationKind === 'user-added' && record.manifest === undefined) {
      throw new CatalogContractError('local-source', [
        semanticIssue(`/${index}/manifest`, 'is required for a user-added standard source'),
      ])
    }
    if (record.registrationKind === 'built-in' && !hasBuiltIn) {
      throw new CatalogContractError('local-source', [
        semanticIssue(`/${index}/builtInProviderKey`, 'is required for a built-in source'),
      ])
    }
    if (record.registrationKind === 'built-in' && record.manifest !== undefined) {
      throw new CatalogContractError('local-source', [
        semanticIssue(`/${index}/manifest`, 'is reserved for user-added standard sources'),
      ])
    }
    if (!uuidPattern.test(record.sourceRecordId)) {
      throw new CatalogContractError('local-source', [
        semanticIssue(`/${index}/sourceRecordId`, 'must be a UUID generated by the Host'),
      ])
    }
    if (!providerIdPattern.test(record.providerId)) {
      throw new CatalogContractError('local-source', [
        semanticIssue(`/${index}/providerId`, 'is not a valid provider claim'),
      ])
    }
    if (!adapterIdPattern.test(record.adapterId)) {
      throw new CatalogContractError('local-source', [
        semanticIssue(`/${index}/adapterId`, 'is not a valid local adapter identity'),
      ])
    }
    if (record.builtInProviderKey !== undefined && !builtInKeyPattern.test(record.builtInProviderKey)) {
      throw new CatalogContractError('local-source', [
        semanticIssue(`/${index}/builtInProviderKey`, 'is not a valid built-in provider key'),
      ])
    }
    if (record.manifestUrl !== undefined) {
      let manifestUrl: URL
      try {
        manifestUrl = new URL(record.manifestUrl)
      } catch {
        throw new CatalogContractError('local-source', [
          semanticIssue(`/${index}/manifestUrl`, 'must be an absolute URL'),
        ])
      }
      const insecureOrigin = probeYunworkMarketContract().insecureOrigin
      const allowInsecure = insecureOrigin !== undefined && manifestUrl.origin === insecureOrigin
      if (
        (!allowInsecure && (manifestUrl.protocol !== 'https:' || manifestUrl.port))
        || (allowInsecure && manifestUrl.protocol !== 'http:' && manifestUrl.protocol !== 'https:')
        || manifestUrl.username
        || manifestUrl.password
        || manifestUrl.search
        || manifestUrl.hash
      ) {
        throw new CatalogContractError('local-source', [
          semanticIssue(`/${index}/manifestUrl`, 'must use credential-free HTTPS on standard port 443 without query or fragment'),
        ])
      }
      const manifest = (record.manifest === undefined || allowInsecure) ? undefined : parseCatalogSource(record.manifest)
      if (manifest !== undefined && manifest.providerId !== record.providerId) {
        throw new CatalogContractError('local-source', [
          semanticIssue(`/${index}/manifest/providerId`, 'must match the pinned provider claim'),
        ])
      }
      if (manifest !== undefined && new URL(manifest.transport.endpoint).origin !== manifestUrl.origin) {
        throw new CatalogContractError('local-source', [
          semanticIssue(`/${index}/manifest/transport/endpoint`, 'must match the registered manifest origin'),
        ])
      }
    }
    if (!Number.isInteger(record.order) || record.order < 0) {
      throw new CatalogContractError('local-source', [
        semanticIssue(`/${index}/order`, 'must be a non-negative integer'),
      ])
    }
    if (ids.has(record.sourceRecordId)) {
      throw new CatalogContractError('local-source', [
        semanticIssue(`/${index}/sourceRecordId`, 'duplicates a local source identity'),
      ])
    }
    ids.add(record.sourceRecordId)
    if (orders.has(record.order)) {
      throw new CatalogContractError('local-source', [
        semanticIssue(`/${index}/order`, 'duplicates a local source order'),
      ])
    }
    orders.add(record.order)
  }
}
