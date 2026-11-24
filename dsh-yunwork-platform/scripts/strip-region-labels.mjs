/**
 * Drop the bundler's `//#region <path>` labels from the emitted files.
 *
 * Every module the bundler inlines is preceded by a label naming its source file, and that name is relative to the
 * output directory. For a module that comes from `node_modules` the label therefore reads differently depending on
 * where that tree happens to sit — when this package is built through its own junction the labels began with
 * `../dsh-desktop-next/node_modules/zod/`, and a build from another layout would have written other bytes for the same
 * source. The tarball's name records the commit, so two builds of one commit that differ only in these labels would
 * claim to be the same artifact while not being the same bytes, and that is the kind of mismatch nobody notices until
 * they cannot reproduce a build.
 *
 * The labels carry no meaning at runtime; they exist to make a bundle readable. Removing them removes the variable.
 * The output carries no sourcemap for the same reason: a map is a list of positions, so removing lines invalidates
 * every position after the first removal — a map that points at the wrong line is worse than no map. Debugging this
 * package means building it from `src/`, which this script does not touch.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputDirectory = resolve(packageRoot, 'lib')

/** Both halves of a region: the opening label and the closing one the bundler writes with no path at all. */
const REGION_LABEL = /^\s*\/\/#(?:end)?region\b.*$/u

const report = []
let removed = 0
for (const name of readdirSync(outputDirectory).filter(entry => entry.endsWith('.js')).sort()) {
  const path = join(outputDirectory, name)
  const lines = readFileSync(path, 'utf8').split('\n')
  const kept = lines.filter(line => !REGION_LABEL.test(line))
  if (kept.length === lines.length) continue
  writeFileSync(path, kept.join('\n'))
  removed += lines.length - kept.length
  report.push(`${name}: ${lines.length - kept.length}`)
}

if (removed === 0) {
  console.log('@yundashi/dsh-yunwork-platform: no region labels in the output; nothing to strip.')
} else {
  console.log(`@yundashi/dsh-yunwork-platform: stripped ${removed} region labels (${report.join(', ')}).`)
}
