/**
 * Client face of `@yundashi/dsh-yunwork-platform`: the account page in the official Settings dialog. Every call goes
 * to the Host face's routes (../shared.ts).
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { YunworkAccountSection, YunworkUserIcon } from './section.tsx'
import { registerYunworkEntries } from './entries.tsx'
import { installYunworkStyles } from './styles.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    yunwork: 'title' | 'language' | 'signIn' | 'signOut' | 'cancel' | 'refresh' | 'waiting' | 'openPage'
      | 'signedInAs' | 'notSignedIn' | 'modelsCount' | 'modelsCustom'
      | 'pNetwork' | 'pServer' | 'pRejected' | 'pSessionEnded' | 'pDenied' | 'pCancelled'
      | 'pExpired' | 'pBusy' | 'pNoModels' | 'pNoCatalog' | 'pNotConfigured' | 'pFailed'
  }
}

export const inject = ['slots', 'layout', 'locale']

/** The section's id: the icon slot is keyed by it, so both registrations carry the same one. */
const SECTION_ID = 'yunwork-platform'

/** The page's wording, registered inline so no locale file has to be fetched before it renders. */
const LABELS = {
  zh: {
    title: '账号与余额', language: 'zh',
    signIn: '登录', signOut: '退出登录', cancel: '取消', refresh: '重新读取模型',
    waiting: '已打开授权页面，正在等待浏览器返回。', openPage: '手动打开授权页面',
    signedInAs: '已登录：{name}', notSignedIn: '未登录', modelsCount: '可用模型：{count}', modelsCustom: '（模型路由已由你手动修改）',
    pNetwork: '无法连接认证服务，请检查网络后重试。',
    pServer: '认证服务暂时出错了，请稍后重试。',
    pRejected: '认证服务拒绝了这次请求。',
    pSessionEnded: '登录已失效，请重新登录。',
    pDenied: '你取消了这次授权。',
    pCancelled: '已取消登录。',
    pExpired: '登录超时了，请重新登录。',
    pBusy: '正在完成上一次登录，请稍候。',
    pNoModels: '这个账户暂时没有可用的模型。',
    pNoCatalog: '还没有读到模型列表，请先刷新。',
    pNotConfigured: '没有配置接口地址，请通过 yunwork-shell 启动，或设置 YUNWORK_API_BASE_URL 与 YUNWORK_AUTH_BASE_URL。',
    pFailed: '操作没有完成，请重试。',
  },
  en: {
    title: 'Account & Balance', language: 'en',
    signIn: 'Sign in', signOut: 'Sign out', cancel: 'Cancel', refresh: 'Reload models',
    waiting: 'The authorization page is open; waiting for the browser to come back.', openPage: 'Open the authorization page',
    signedInAs: 'Signed in as {name}', notSignedIn: 'Not signed in', modelsCount: 'Models available: {count}', modelsCustom: '(the model route was edited by hand)',
    pNetwork: 'Couldn\'t reach the sign-in service. Check your connection and try again.',
    pServer: 'The sign-in service had a problem. Try again shortly.',
    pRejected: 'The sign-in service refused this request.',
    pSessionEnded: 'Your sign-in has ended. Sign in again.',
    pDenied: 'You cancelled the authorization.',
    pCancelled: 'Sign-in cancelled.',
    pExpired: 'Sign-in timed out. Try again.',
    pBusy: 'The last sign-in is still finishing.',
    pNoModels: 'This account has no models available yet.',
    pNoCatalog: 'The model list has not loaded yet. Reload it first.',
    pNotConfigured: 'No API origin is configured. Start through yunwork-shell, or set YUNWORK_API_BASE_URL and YUNWORK_AUTH_BASE_URL.',
    pFailed: 'That did not finish. Try again.',
  },
} as const

export function apply (ctx: Context): void {
  installYunworkStyles(ctx)
  ctx.effect(() => ctx.locale.register('yunwork', LABELS), 'yunwork: labels')
  const t = ctx.locale.bind('yunwork')
  // The settings shell draws a section's navigation glyph from `settings.section.icon`, keyed by the section id.
  ctx.slots.inject('settings.section.icon', () => ctx.slots.register({ name: 'settings.section.icon', id: SECTION_ID }, YunworkUserIcon))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: SECTION_ID, order: -10, locale: 'yunwork', label: () => t('title'), inject: () => ({}),
  }, YunworkAccountSection))
  registerYunworkEntries(ctx, { label: () => t('title') })
}
