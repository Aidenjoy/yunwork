# @yundashi/dsh-yunwork-platform

云大师的平台插件：把云大师账号（Utoken）接进宿主应用，并把它背后的模型网关写成宿主认识的模型路由。

一个插件，两件事：

- **账号**。OAuth PKCE + loopback 回调完成登录，拿到语言模型 key，存进宿主自己的凭据库（不是明文，走 `CredentialProvider`）。
- **模型路由**。把网关的文本模型清单写成 `llm-pi-ai` 的一条 provider，协议固定 `anthropic-messages`，`baseURL` 用部署 origin，不拼 `/v1`。

另外附带一条只读诊断路由 `GET /api/yunwork/diagnostics`，用来回答「这个插件到底有没有接进应用真正运行的那个 Profile」。它刻意不去推导路径：Profile 目录只从启动器给的 `profileContext` 读，读不到就回 `null`，而不是自己拼一个看起来对的值。

## 部署契约

插件自身不含任何环境地址。所有部署事实来自一个生成的 JSON 文件 `yunwork-runtime.json`，**契约版本 `1`**，恰好 16 个键：

```
version, productName, shortName, tagline, appId, dataDirName,
defaultLocale, brandColor, backgroundColor, themeColor, artifactPrefix,
apiBaseUrl, authBaseUrl, insecure, updateFeedUrl, env
```

该文件是严格校验的：多一个键（包括内部保留的 `profileKey`）都会被拒。版本不匹配同样会被拒，并且错误信息会说明该怎么重新生成。

读取顺序，后者覆盖前者：

1. 内置默认值（品牌 9 个键 + `env: 'prod'` + `insecure: false`）
2. `yunwork-runtime.json`
3. 进程环境变量 `YUNWORK_*`
4. 插件 `Config`（宿主配置系统）

`apiBaseUrl` 与 `authBaseUrl` 没有默认值，缺失即启动失败——宁可启动失败，也不要悄悄回落到生产地址。`http://` 的 origin 需要 `insecure: true` 显式放行。

文件位置探测顺序：`YUNWORK_RUNTIME` → `process.resourcesPath/yunwork-runtime.json` → `dirname(process.execPath)/resources/yunwork-runtime.json`。都没有则降级：不注册账号与模型路由，只保留诊断。

## 构建

```
npm install        # 或 yarn install；不依赖 workspace
npm run build      # tsdown 双 face 构建 + client externals 门禁
npm run typecheck
npm test
```

产物两个 face，都落在 `lib/`：

- `lib/index.js` —— Host 侧，ESM，`platform: node`
- `lib/client.js` —— Client 侧，CJS，由 `window.__ModuleLoader__.load({...})` 包裹

Client face 的 `require` 只允许 5 个外部包，构建后由 `scripts/verify-client-externals.mjs` 强制校验，越界即构建失败。

首次在新克隆里构建前，如果 `node_modules` 还没有宿主的那批 peer，跑一次 `npm run link` 把它们软链过来。

## 目录

```
src/shared.ts          路由表与前后端共用的类型
src/host/env-config.ts 部署契约的读取与校验
src/host/api-client.ts 网关 HTTP 调用（全部带超时、zod 校验与尺寸上限）
src/host/account.ts    PKCE 登录、凭据落盘、登出
src/host/models.ts     模型清单 → llm-pi-ai provider，含用户手改的检测
src/host/settings.ts   插件 Config 的读写
src/host/diagnostics.ts 诊断取数
src/host/shell.ts      用系统浏览器打开授权页
src/index.ts           Cordis 插件入口与路由注册
src/client/            设置面板（文案内联注册，不读外部 locale 文件）
tests/                 runtime 契约、诊断与路径探测的单元测试
```

本包**不自带 `cordis.patch.yml`**。挂载只有一条路：由 Desktop 的 `cordis.patch.yml` insert 一行指向本包，避免同一个 Row id 出现在两个 patch 里。
