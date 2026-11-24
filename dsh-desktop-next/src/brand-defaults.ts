/**
 * The brand a build carries when no runtime contract is beside it.
 *
 * Two modules read brand values and only one of them may touch the file system. This one is pure: it holds the type
 * every face shares and the values a build without a contract falls back to, so a renderer may import it without
 * dragging `node:fs` into a bundle that runs with `sandbox: true` and no Node. `brand.ts` is the resolver, and it is
 * the main process's alone.
 *
 * The fallback values are the upstream Desktop's own, verbatim. That is deliberate rather than convenient: the tests
 * assert upstream text, and the resolver's last resort being the upstream snapshot is what keeps them meaningful — they
 * describe a build that was given no brand, which is exactly the build a test runs in.
 */

/**
 * The part of the runtime contract the Desktop reads about itself.
 *
 * The contract carries sixteen keys because the account plugin needs them all; the Desktop only ever asks who it is,
 * where its data lives and whether it owns an update feed. Keeping the list this short is what stops a brand value
 * from being invented here that the generator never produces.
 */
export interface Brand {
  productName: string
  /** The bundle identity: what the signing and update checks compare against, so it must match the packaging. */
  appId: string
  /** The default home directory's name under the user's home: `.dsh` upstream, dotted and brand-specific here. */
  dataDirName: string
  /** The feed this build updates from, or `null` when it does not update itself. */
  updateFeedUrl: string | null
}

/** The upstream Desktop's identity, used when this build was given none. */
export const UPSTREAM_BRAND: Brand = {
  productName: 'DSH NEXT',
  appId: 'ai.deepseek.dsh.desktop.next',
  // The upstream default home is the shared `~/.dsh`; the directory under the user's application data is named after
  // the product instead. The two are separate decisions and a brand changes both.
  dataDirName: '.dsh',
  updateFeedUrl: null,
}
