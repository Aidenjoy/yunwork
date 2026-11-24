/**
 * Point this package's `node_modules` at the desktop base's dependency tree.
 *
 * `dsh-yunwork-platform` is deliberately not a workspace member: the base owns the composition, and adding a second
 * workspace would put our package in the same install graph as the layers we must not modify. Yarn installs nothing
 * for a package outside the workspace list, and `nmHoistingLimits: workspaces` keeps `@deepseek-ai/*` inside
 * `dsh-desktop-next/node_modules` alone, so neither `tsc` nor `tsdown` could resolve a single peer.
 *
 * One junction to that tree fixes both, and it is also the correct version story: the plugin is loaded by the desktop,
 * so it must be built against exactly the peers that desktop ships, never a hoisted copy that may differ.
 *
 * Idempotent; a path that already exists is checked and left alone.
 */
import { existsSync, lstatSync, realpathSync, symlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = resolve(process.env.YUNWORK_PEERS ?? resolve(packageRoot, '..', 'dsh-desktop-next', 'node_modules'))
const link = resolve(packageRoot, 'node_modules')

function fail (message) {
  console.error(`link-peers: ${message}`)
  process.exitCode = 1
}

/** The peers and build tools that must resolve for typecheck and build; no more than that. */
const REQUIRED = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-credentials',
  '@deepseek-ai/dsh-settings',
  '@deepseek-ai/dsh-config-editor',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/schemastery',
  'react',
  'zod',
  'typescript',
  'tsdown',
  'vitest',
]

function resolvesHere () {
  return REQUIRED.filter(peer => !existsSync(resolve(link, peer, 'package.json')))
}

if (!existsSync(target)) fail(`${target} does not exist; install the workspace first (yarn install)`)
else if (existsSync(link)) {
  const existing = lstatSync(link)
  if (!existing.isSymbolicLink()) {
    // A real tree of our own (an earlier install): usable when it holds every peer.
    const missing = resolvesHere()
    if (missing.length === 0) console.log(`link-peers: ${link} already holds every peer; nothing to do`)
    else fail(`${link} is a real directory missing ${missing.join(', ')}; remove it, then run this again`)
  } else if (resolve(realpathSync(link)) !== resolve(realpathSync(target))) fail(`${link} points at ${realpathSync(link)}, not ${target}`)
  else console.log(`link-peers: ${link} already points at ${target}`)
} else {
  symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
  console.log(`link-peers: ${link} -> ${target}`)
}
