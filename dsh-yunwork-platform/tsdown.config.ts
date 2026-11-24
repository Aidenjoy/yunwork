/**
 * Two faces, as the desktop loads them.
 *
 * The Host face is Node ESM: its peers stay external and the installation that loads the plugin supplies them.
 *
 * The client face must be one CommonJS factory. The shell's module loader does not evaluate the file as a module; it
 * reads `window.__ModuleLoader__.load({ id, factory: (require) => { ... } })` and calls the factory with its own shared
 * module table. Three settings make that work and none is redundant: `format: 'cjs'` emits `require`/`module.exports`,
 * `intro` gives this file the `module` and `exports` a CommonJS wrapper would have provided, and `banner`/`footer` wrap
 * the whole thing in the loader call and return the exports. Emitting ESM here would parse but never run, because
 * nothing would ever call the factory.
 */
import { defineConfig } from 'tsdown'

const PACKAGE_NAME = '@yundashi/dsh-yunwork-platform'

/**
 * Keep the comments a licence needs, drop the prose.
 *
 * The docs of every inlined module travel with it, and none of them is of any use to the reader of a bundle; the
 * licence headers do have to survive. This option cannot reach the bundler's own `//#region <path>` labels — those are
 * emitted as output structure, not as input comments — so `scripts/strip-region-labels.mjs` removes them afterwards.
 */
const COMMENTS = { legal: true, annotation: false, jsdoc: false } as const

export default defineConfig([
  // The Host face: Node ESM; its peers stay external, left to the installation that loads it.
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib', format: 'esm', platform: 'node', target: 'es2024',
    fixedExtension: false, dts: false, clean: true, sourcemap: false,
    // The one non-peer dependency is inlined: the plugin is loaded from the profile, which resolves its peers from the
    // desktop's tree but does not install packages for it, so a bare `import 'zod'` would be the single line able to
    // stop it loading. Peers stay external and must be the desktop's own instances.
    noExternal: ['zod'],
    outputOptions: { comments: COMMENTS },
  },
  // The client face: one CommonJS factory for the shell's module loader, which supplies the shared modules below.
  {
    name: `${PACKAGE_NAME}/client`,
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib', format: 'cjs', platform: 'browser', target: 'es2022',
    fixedExtension: false, dts: false, clean: false, sourcemap: false,
    external: [
      'react',
      'react/jsx-runtime',
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-client-ui-primitives',
      '@deepseek-ai/dsh-client-ui-slots',
    ],
    outputOptions: {
      entryFileNames: 'client.js',
      comments: COMMENTS,
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_NAME)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
