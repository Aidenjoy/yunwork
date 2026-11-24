# 第 2 层改动清册

这份文件只做一件事：让 `sync fork` 之后有人在十分钟内判断「哪些冲突是我们自己的、为什么必须在这里、能不能合并」。

## 三层边界

| 层 | 位置 | 规矩 |
|---|---|---|
| 第 3 层 · 可写 | `yunwork-shell/`、`dsh-yunwork-platform/`、`vendor/yundashi/` | 品牌、账号、打包入口都住在这里。与上游同步时整目录保留 |
| 第 2 层 · 例外可写 | `dsh-desktop-next/` 的 3 个既有文件 + 2 个新文件 | 只允许**声明式接缝**：读一个契约、少写几个字面量、多一行依赖。不允许状态机、不允许业务分支 |
| 第 1 层 · 禁区 | `deepseek-harness/`、`node_modules/`、`patches/`、LICENSE 法律主体 | 不改。`dsh://` scheme、`llm-deepseek*`/`web-deepseek*` 模型供应商标识、`x-dsh-*` 协议头一律保留 |

## 改动清单

真实数据取自 `git diff --numstat`，不是计划数字。两个提交：`571adcc`（接缝）、`40df182`（品牌面）。

### A. 依赖与挂载接缝

| 文件 | 行数 | 性质 | 为什么必须在这里 | 复核方式 |
|---|---|---|---|---|
| `dsh-desktop-next/package.json` | +2 / −0 | 一行依赖 | payload 闭包从 `dependencies` 出发，只有写在这里插件才会进原生包与签名流程 | 看 `dependencies` 里 `@yundashi/dsh-yunwork-platform` 那行，指向 `vendor/yundashi/*.tgz` |
| `dsh-desktop-next/cordis.patch.yml` | +21 / −0 | 一段 insert + 三条禁用 | `profiles.ts` 无条件把这个文件当 bundle layer 追加，对所有 Profile 生效：挂载 yunwork-platform，并禁用 ui-settings-account / deepseek-account / llm-deepseek-account（其 `/auth-api/v0/dsh/*` 协议与 yundashi 网关不兼容，auth_init 响应过不了它的 schema，登录必然弹「操作未完成」）。禁用写在 bundle 层而非用户家目录补丁，打包版与 dev 行为一致 | 三条 `disabled: true` 加一条 `id: yunwork-platform` insert |
| `vendor/yundashi/…c2f49e9eec9ef.re7c3fbf4.tgz` | 二进制 | 预构建产物 | 与既有 `@agents-anywhere/dsh-bridge-next` 同构：文件名带 commit 与 peer 区间两段指纹，`yarn.lock` 另记 `hash=` | `npm pack` 可从 `dsh-yunwork-platform/` 复现 |
| `yarn.lock` | +14 / −19 | 锁文件 | 由上面的依赖产生 | `corepack yarn install` 后应无差异 |

### B. 品牌面

新增两个文件，其余既有文件只替换字面量。

| 文件 | 行数 | 性质 |
|---|---|---|
| `src/brand-defaults.ts` | +39（新） | 纯常量：`Brand` 类型与上游身份。**不 import 任何模块** |
| `src/brand.ts` | +86（新） | 解析器：读 `yunwork-runtime.json`，四路探测，**唯一 touch 文件系统的地方** |
| `src/desktop-contract.ts` | +6 / −0 | `import type` + `brand` 字段 |
| `src/main.ts` | +33 / −17 | `setName`、崩溃上报名、快捷方式名、七个对话框标题、两处重启文案、`updates` 的 disabled 入参 |
| `src/update-installer.ts` | +6 / −4 | `NEXT_APP_ID = appId`（三个消费者自动跟随）、ProductName 校验、更新中的标题与文案 |
| `src/update-state.ts` | +4 / −0 | `disabled` 字段 + 更新文案 / 动作两处早退 |
| `src/updates.ts` | +8 / −2 | `disabled` 入参，`start`/`check`/`download` 三处早退 |
| `src/sandbox-launch.ts` | +19 / −18 | 沙箱失败解释的六段文案 |
| `src/host-startup-limit.ts` | +9 / −4 | `startupNoticeCopy` 增加可选的 `productName` 末位参数 |
| `src/menu-locale.ts` | +3 / −2 | `roleApplicationMenuTemplate` 同上 |
| `src/program-directory.ts` | +7 / −6 | 目录冲突拒绝文案 |
| `src/native-desktop.ts` | +6 / −5 | 托盘提示、更新通知、启动超时通知 |
| `src/desktop-menu.ts` | +2 / −1 | 托盘「打开…」 |
| `src/notifications.ts` | +3 / −2 | 两处「打开…查看详情」 |
| `src/failure-report.ts` | +2 / −1 | 报告首行 |
| `src/app-downloads.ts` | +2 / −1 | 下载失败对话框标题 |
| `src/runtime-tree.ts` | +2 / −1 | payload 与身份不匹配的报错 |
| `src/data-directory.ts` | +15 / −5 | 默认家目录用 `dataDirName`，appData 目录用 `productName`，两者分开 |
| `src/desktop-terminal/windows-shell.ts` | +6 / −1 | 终端窗口标题 |
| `src/main-window-state.ts` | +1 / −1 | 注释 |
| `src/client/settings.tsx` | +10 / −4 | `desktopTranslate(language, productName)` |
| `src/client/updates.tsx` | +2 / −1 | 版本行 |
| `src/native-ui/onboarding.tsx` | +3 / −2 | 欢迎页标题 |
| `src/native-ui/main.tsx` | +2 / −1 | bridge 缺失时的通用文案（此时读不到品牌） |

合计：**+232 / −82**（既有文件），**+125**（两个新文件），加一个 vendor tarball。

### C. 打包接缝

| 文件 | 行数 | 性质 | 为什么必须在这里 | 复核方式 |
|---|---|---|---|---|
| `scripts/prepare-payload.ts` | +14 / −1 | 条件追加一条复制项 | 运行时契约必须随 payload 进 `app.asar`：CLI 无法往 `extraResources` 这个数组里追加（见下），而 payload 的复制清单是唯一能带文件进包的位置。文件不存在时清单与改动前一致 | `shellEntries()` 只在 `yunwork-runtime.json` 存在时追加它 |
| `scripts/package.ts` | +43 / −2 | 读一个 env 指向的 JSON，追加标量配置 | 安装包名、快捷方式、bundle id、产物文件名只能通过 electron-builder 的标量配置覆盖 | 未设 `YUNWORK_BRAND_CONFIG` 时 `brandFlags()` 返回空数组 |

**`extraResources` 此路不通（实测，别再试）**：`--config.extraResources[0].from=x` 被 yargs 解析成键名 `extraResources[0]`；`--config.extraResources.0.from=x` 解析成 `{"extraResources":{"0":{…}}}`；而 `builder-util-runtime` 的 `deepAssign` 不会把它并进数组。三条结果都是对象，schema 拒绝。契约改走 payload 之后，这个限制不再影响品牌落地。

`brandFlags()` 只动五个标量：`appId`、`productName`、`nsis.shortcutName`、`mac/win/linux.artifactName`、`deb.packageName`（转小写）。产物名里的 `${version}` / `${arch}` / `${ext}` 是 electron-builder 的宏，脚本里用单引号原样保留。

### D. 图标路线

图标不走第 2 层。**base 的 `build/` 与 `assets/` 二进制资产一个字节都不进版本库**（否则每次 sync 都是二进制冲突，且 `app-icon` 相关用例会红）。做法全在 `yunwork-shell/`：

- `scripts/export-yunwork-icons.mjs`：从 `assets/` 的源图渲染 31 个产物 —— 1024 三档 PNG、ICO（16 帧）、ICNS（7 段）、Linux 九档、两套 Icon Composer bundle（克隆 `icon.json` 删除 `NEXT Badge` 组，保留 `whale-cobalt.svg` / `DeepSeek.svg` 两个文件名）、六个托盘图标
- `scripts/icon-overlay.mjs`：覆盖前逐文件备份并把计划写盘，`restoreOverlay` 让工作树回到原样；重复调用安全
- `run.mjs`：`build` / `dist` 前置生成 + 覆盖 + 写入临时契约，`finally` 里还原并删除契约；`dev` 不动工作树

往返实测：写 31 删 2，还原 33 个，`build/` 与 `assets/` 合并的聚合 sha256 前后一致。

## 三条判据逐条过

**1. 声明式。** 没有状态机、没有分支决策。`brand.ts` 的四路探测是 Fallback 链，不是业务；`updates.ts` 的三处早退是 `disabled === true` 一个条件。

**2. 无业务逻辑。** 全部业务仍在第 3 层：账号、模型路由、契约生成都在 `dsh-yunwork-platform/` 与 `yunwork-shell/`。第 2 层只做两件事——读一个 JSON、把已有字面量换成读到的值。

**3. 不含硬编码品牌值。** `DSH NEXT` 在本层仍出现 5 次，全部登记在案：

| 位置 | 为什么留着 |
|---|---|
| `src/brand-defaults.ts` 的 `productName` | 这是上游身份的**唯一**出处，本层所有兜底都引用它。它必须叫这个名字，否则「没给契约的构建看起来像上游」就不成立。数据目录名已改为 `.dsh`，不再是第二个字面量 |
| `src/data-directory.ts` 的一句注释 | 说明上游 appData 目录叫 `DSH NEXT`，没有代码读它，登记给校验器以免出现 unexplained hit |
| `src/update-installer.ts` 的 ObjC 脚本兜底两处 | 进程内 fallback，正常路径由主进程传入的变量覆盖 |
| `src/native-ui/index.html` 的 `<title>` | 静态文件，读不到契约。窗口标题已由 `page-title-updated` 压住（见下），页内不显示它 |

## 一条必须知道的结构约束

**`brand.ts` 只能被主进程 import。** 它 import 了 `node:fs`，而渲染层与 preload 跑在 `sandbox: true` / `contextIsolation: true`、没有 Node 的环境里。

- 渲染层：读 `DesktopState.brand`。这是唯一合法来源
- 渲染层兜底：import `brand-defaults.ts`（零 import，安全）
- 契约的三条来路，按优先级：`YUNWORK_RUNTIME` 显式指定（缺失即抛错） → `resourcesPath/yunwork-runtime.json` → `resourcesPath/app.asar/yunwork-runtime.json`（打包态的真正来源） → 上游身份。`dsh-desktop-next/yunwork-runtime.json` 只在 `run.mjs` 打包期间存在，`finally` 删除
- Host 是独立 Node 进程，读不到 asar 内部：`asarUnpack` 把同一份契约写到 `app.asar.unpacked/`，主进程优先把那个真实路径通过 `YUNWORK_RUNTIME` 交给 Host；插件侧的 `env-config` 也直接探测该目录
- 已发生过的两次事故，写在这里省下一次：
  - `client/settings.tsx` 直接 import `brand.ts` → `lib/client.js` 里出现 `require("node:fs")`，client 插件整体加载失败
  - `menu-locale.ts` import `brand.ts` → 被 `preload-menu.ts` 带进 `lib/preload-app.cjs`，`verify:frontend` 报 `Sandboxed preloads may not require local chunks or Node modules`

**复核断言（比行数配额重要）：**

```bash
cd dsh-desktop-next
for f in lib/preload-*.cjs lib/client.js; do echo "$f $(grep -c 'node:fs' $f)"; done   # 全 0
grep -rl 'node:fs' lib/native-ui | wc -l                                               # 0
```

## 单向门登记

**`yarn icons:export --channel next` 自 Phase 3D 起不可用。** `scripts/export-app-icons.mjs` 的生成模式要求 `#3563BF` 在源 SVG 中恰好出现一次；品牌图标不含这个颜色，会直接抛错，而 `--check` 模式走的是另一条分支、不触发该断言，所以它不会自己冒出声音。

图标改版一律走 `yunwork-shell/scripts/export-yunwork-icons.mjs`，它按本仓的 `resources.json` 重写产物清单。这条门是单向的：一旦 `build/` 里的上游资产被替换，回到 `icons:export` 只能靠 `git checkout` 还原资产。

## 已知限制

1. **`dist:win:next` 结构性不可离线。** 所有 `*:next` 入口前置 `yarn aa:prepare-release`，`prepare-agents-anywhere-release.mjs` 在 `--verify-release` 下强制要求 `sourceRef === 'main'` 且仓库为官方 AA，而 `DSH_AA_SOURCE_REF=pinned` 已被显式拒绝。我们的离线做法只对 `dev` / `package:dir` 注入 40 位 commit；安装包构建仍需网络。
2. **`native-ui/index.html` 的静态 title 仍是上游名。** 窗口标题已由 `page-title-updated` 压住，页内不显示；彻底清除需要构建期改写静态 HTML，收益不抵风险。
3. **深色图标变体沿用同一张图。** 只做了 default 与 classic 两套，dark 变体暂与 default 同源。
4. **`dev` 不做图标覆盖。** 品牌图标只在 `build` / `dist` 注入；`yarn shell dev` 的托盘仍是上游鲸鱼。原因是覆盖要持续整个开发会话，中途 Ctrl-C 可能来不及还原，风险大于收益。
5. **Windows 目标在本机无法完成 payload 密封**：`prepareCuaWindowsNative` 要调 .NET SDK（`runDotnet`），本机没有。Linux 目标可以，实际密封出 28780 个文件、契约 494 字节带 sha256。这条是环境限制，不是代码问题。
6. **打包进程被强杀时**工作树里会留下 `dsh-desktop-next/yunwork-runtime.json` 与 `yunwork-shell/.yunwork-build/icons-backup/`。前者删掉即可，后者跑一次 `restoreOverlay`（或删目录后 `git checkout -- dsh-desktop-next`）恢复。
7. **品牌构建没有应用内更新。** 版本检查只有一个固定端点，接不了品牌自己的 feed；与其让品牌构建去轮询上游服务，品牌态一律 `disabled`。三个 profile 的 `updateFeedUrl` 都是 `null`，等检查器支持自定义 origin 后再接线。
8. **未注入契约的构建保持上游行为。** 无契约时 `contractPath` 为 `undefined`，`disabled` 为假，上游构建照旧检查更新；这也是第 7 条只对品牌态生效的原因。
9. **Windows 终端标题不含中文。** `.cmd` 按控制台代码页解码，UTF-8 的品牌名在 GBK 下会乱码；非 ASCII 名称退回中性标题，ASCII 名称照旧。
10. **浏览器回退依赖系统协议处理器。** 桌面登录窗口打不开时会退回系统默认浏览器；极老的 Windows 若缺少 URL 协议处理器，接口返回 `none`，页面仍保留手动打开授权的链接。
11. **`tests/` 一行未改，前提是「测试环境各路全 miss」。** 这些路径在测试里都取不到契约（`YUNWORK_RUNTIME` 未设、`process.resourcesPath` 未定义、`dirname(execPath)/resources` 与 `app.asar` 不存在），因此 103 处上游断言仍然成立。**若将来有人在测试进程里设了 `YUNWORK_RUNTIME`，这 103 处会一起变红**——那是设计使然，不是回归。
12. **7 项 vitest 失败是本机环境所致**，与本改动无关：Windows 下无权创建符号链接（`diagnostics`、`mac-runtime`、`sign-runtime`）、Linux 桌面项（`installed-app-icon` 两项）、登录 shell（`shell-environment`）、POSIX 路径期望（`official-computer-use`）。同一批失败在改动前同样存在。其余 1440 项通过，41 项跳过。

## 根目录 package.json 的 yunwork 入口（第 3 层，不在第 2 层配额内）

| 脚本 | 命令 | 与 `*:next` 的差别 |
|---|---|---|
| `yunwork:dev` | `run.mjs dev` → `dev:yunwork` | 去掉 `market:prepare`：它跟随 npm latest，dshmarket 1.80.2 出现过「manifest 已发、tarball 404」的窗口，会让整条命令第一步就失败 |
| `yunwork:build` | `run.mjs build` → `package:dir:yunwork` | 同上 |
| `yunwork:dist` | `run.mjs dist` → `dist:win:yunwork` / `dist:mac:yunwork` | 同上；`--verify-release` 仍保留，见已知限制第 1 条 |
| `yunwork:dev:prod` / `yunwork:check` | 直连 run.mjs / 两项校验 | — |

## sync fork 复核步骤

```bash
# 0. 一次跑完下面三项：越界文件、行数不符、字面量越界、沙箱产物含 node:fs
node yunwork-shell/scripts/verify-layer2.mjs

# 1. 本层到底改了哪些文件
git log --oneline --stat 571adcc^..HEAD -- dsh-desktop-next vendor/yundashi

# 2. 行数是否仍在本册登记范围内（超出即有人越界）
git diff --numstat 571adcc^ HEAD -- dsh-desktop-next vendor/yundashi

# 3. 品牌字面量是否仍只在登记的 5 处
grep -rn "DSH NEXT" dsh-desktop-next/src/
```

第 3 步若多出别的文件，说明有人把品牌值写回了第 2 层，按本册的「结构约束」一节改回去。
