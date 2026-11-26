# README_MY — 我的备忘

## 1. deepseek-harness 目录是空的？初始化子模块

`deepseek-harness/` 是一个 Git 子模块（pinned upstream），clone 后默认是空目录，需要执行：

```bash
git submodule update --init --recursive
```

> 注意：这是只读的上游代码，不要在功能分支里直接修改 `deepseek-harness/` 内的文件。

## 2. 环境准备

- Node.js `^24.22.3`
- 通过 Corepack 使用根目录 Yarn `4.18.0`

安装依赖（在仓库根目录执行）：

```bash
corepack yarn install --immutable
```

### 踩坑：Corepack 下载 Yarn 失败（ECONNRESET / repo.yarnpkg.com）

国内网络访问 `repo.yarnpkg.com` 可能 TLS 握手失败。让 Corepack 改从国内镜像下载 Yarn 本体：

```bash
COREPACK_NPM_REGISTRY=https://registry.npmmirror.com corepack yarn --version
```

下载成功后会缓存在本地，之后正常执行 `corepack yarn ...` 即可，不需要再带这个环境变量。

### 踩坑：install 时报 `The onCancel handler was attached after the promise settled`

这是 Yarn 4 把网络失败包装后的表象错误，真实原因是默认源 `registry.yarnpkg.com` 下载依赖包时断连。改用国内镜像源安装：

```bash
YARN_NPM_REGISTRY_SERVER=https://registry.npmmirror.com corepack yarn install --immutable
```

> 安装输出里大量 `YN0060` / `YN0002` peer dependency 警告是仓库多变体设计导致的，属于正常现象，不是错误。

## 3. 如何运行（开发）

```bash
corepack yarn yunwork:dev
```

- 使用 dev 环境（`--env=dev`）的品牌配置，基于工作区源码启动桌面应用。
- 如果想用 prod 环境配置跑开发：

```bash
corepack yarn yunwork:dev:prod
```

## 4. mac 打包

### 4.1 Intel 机器（打 Intel/x64 版 dmg）

```bash
corepack yarn yunwork:build
cd dsh-desktop-next
node node_modules/electron-builder/cli.js --prepackaged "dist/mac/DSH NEXT.app" --mac dmg --x64 --config.mac.identity=null --config.forceCodeSigning=false --publish never
ls -lh dist/*.dmg
```

产物：`dsh-desktop-next/dist/DSH-NEXT-<版本号>-x64.dmg`（实测约 659 MB）。

### 4.2 M 芯片机器（打 Apple silicon/arm64 版 dmg）

```bash
corepack yarn yunwork:build
cd dsh-desktop-next
node node_modules/electron-builder/cli.js --prepackaged "dist/mac/DSH NEXT.app" --mac dmg --arm64 --config.mac.identity=null --config.forceCodeSigning=false --publish never
ls -lh dist/*.dmg
```

产物：`dsh-desktop-next/dist/DSH-NEXT-<版本号>-arm64.dmg`。

### 4.3 签名正式发布（配好 Developer ID 证书和公证凭据后才用）

在 Intel 机器上（只出 x64 签名包）：

```bash
DSH_MAC_RELEASE_ARCHS=x64 corepack yarn yunwork:dist
```

在 M 芯片机器上（只出 arm64 签名包）：

```bash
DSH_MAC_RELEASE_ARCHS=arm64 corepack yarn yunwork:dist
```

在 M 芯片机器上打全部三种（arm64 + x64 + universal，x64 检查走 Rosetta）：

```bash
softwareupdate --install-rosetta --agree-to-license
corepack yarn yunwork:dist
```

> 不带 `DSH_MAC_RELEASE_ARCHS` 时默认打三种；universal 三合一只是兼容旧版 updater 的默认项，没有存量用户升级需求时不打也行。在 Intel 机上跑不带 `=x64` 的 dist 会报 "The arm64 macOS package can only be built and checked on an Apple silicon Mac"，这是设计限制不是 bug。

### 打包注意事项

- **新机器首次打包报 "Failed to check actool version. Is Xcode 26 or higher installed?"**：是 Xcode 首次启动组件没装，不是版本问题，执行 `sudo xcodebuild -runFirstLaunch` 后重跑即可（仍不行再补 `sudo xcode-select --reset`）。
- **末尾报 `No packaged Next executable to verify` 可忽略**：那是仓库发布流程的校验钩子，dmg 在这个报错之前已经生成完毕，用 `ls dist/*.dmg` 确认即可。
- **未签名 dmg 客户首次打开被 Gatekeeper 拦截**：让客户右键→打开，或执行 `xattr -dr com.apple.quarantine "/Applications/DSH NEXT.app"`。要消除这个拦截只能走 4.3 的签名路线。
- dmg 里的 Applications 拖拽安装界面是 electron-builder 的 dmg target 生成的（GitHub 自动发布的项目也是调它），与签名无关；不要用纯 `hdiutil create -srcfolder xxx.app` 代替，那样卷里只有一个 app，不符合 Mac 安装习惯。
- 打包期间 `git status` 会短暂出现几十个图标文件改动，命令结束后脚本自动还原，不用管也不用加 .gitignore；若被强杀残留，`git checkout -- dsh-desktop-next/assets dsh-desktop-next/build` 恢复。

## 5. 其他常用命令

```bash
# yunwork 层校验（layer2 + 布局检查）
corepack yarn yunwork:check

# 单元测试 / 类型检查 / 完整无头检查
corepack yarn test
corepack yarn typecheck
corepack yarn check
```

> `yunwork:*` 命令是 `yunwork-shell/scripts/run.mjs` 的封装：先生成品牌运行时配置（`yunwork-runtime.json`），再执行底层 `dsh-desktop-next` 的对应脚本；跳过了 `market:prepare` 的 npm latest 刷新，使用已提交的固定版本，保证可复现构建。