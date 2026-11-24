/**
 * The desktop's half of the sign-in window, where the base serves it.
 *
 * DSH Next lends a plugin a built-in sign-in window through the `desktopTokensAnywhere` service. That service is
 * optional here: a plain `dsh web`, a test Host and any edition without it must all still sign in, so the shell falls
 * back to the operating system's browser and simply never learns that the user closed a window it did not open.
 */
import { spawn } from 'node:child_process'

/** The subset of the desktop's sign-in service this plugin uses. */
export interface DesktopSignInShell {
  /** Show an attempt's authorize page; its navigation to `callback` is handed back to the Host's listener. */
  openLogin? (url: string, callback: string): void
  /** Close the sign-in window; `focus` brings the application forward. */
  closeLogin? (focus: boolean): void
  /** The user closed the sign-in window before the attempt ended. */
  onLoginClosed? (listener: () => void): () => void
}

/**
 * Read the optional service without declaring it: another plugin (the upstream account, say) may declare the same
 * context key with its own shape, and two declarations of one key cannot coexist in one program.
 */
export function desktopSignInShell (ctx: object): DesktopSignInShell | undefined {
  return (ctx as { desktopTokensAnywhere?: DesktopSignInShell }).desktopTokensAnywhere
}

/**
 * Open a URL with the operating system's default browser; a failure leaves sign-in to the page's own link.
 *
 * Windows goes through `rundll32` rather than `cmd /c start`: `cmd` re-parses everything after `/c`, and an authorize
 * URL carries `&state=` and a PKCE challenge, so the URL would be cut at the first `&` — or worse, executed. `rundll32`
 * takes the URL as one argument that never reaches a shell, so it needs no quoting and no escaping.
 */
export function openWithSystemBrowser (url: string): boolean {
  if (!url.startsWith('https://') && !url.startsWith('http://')) return false
  const [command, args] = process.platform === 'win32'
    ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.unref()
    return true
  } catch {
    return false
  }
}

export class YunworkShell {
  private desktop: DesktopSignInShell | undefined
  private detached: (() => void) | undefined
  private disposed = false

  /**
   * @param closed - the user closed the sign-in window before the attempt ended.
   */
  constructor (private readonly closed: () => void) {}

  /**
   * Use the desktop's window while the service lasts.
   * @returns its release, for the effect that holds it.
   */
  attach (desktop: DesktopSignInShell): () => void {
    this.desktop = desktop
    const stop = desktop.onLoginClosed?.(() => { this.closed() })
    this.detached = stop
    return () => {
      stop?.()
      if (this.desktop === desktop) this.desktop = undefined
    }
  }

  /**
   * Show the authorize page.
   *
   * The desktop's window is preferred while its service lasts, but it is a service rather than a guarantee: a window
   * that cannot be created must not end the sign-in, because the browser is still a working way back.
   * @returns `window` when the desktop opened it, `browser` when the operating system did, `none` when neither could.
   */
  openLogin (url: string, callback: string): 'window' | 'browser' | 'none' {
    if (this.disposed) return 'none'
    if (this.desktop?.openLogin !== undefined) {
      try {
        this.desktop.openLogin(url, callback)
        return 'window'
      } catch {
        // Fall through: the page's own link and the system browser both remain.
      }
    }
    return openWithSystemBrowser(url) ? 'browser' : 'none'
  }

  closeLogin (focus: boolean): void {
    if (!this.disposed) this.desktop?.closeLogin?.(focus)
  }

  dispose (): void {
    this.disposed = true
    this.detached?.()
    this.desktop = undefined
  }
}
