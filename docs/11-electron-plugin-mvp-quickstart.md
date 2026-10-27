# Electron 插件 MVP 使用说明

本文面向维护 IT Tools 插件的开发者和桌面应用用户。当前 MVP 只支持 Electron 桌面版的本地 `.itplugin` 包。Web 和 Docker 版继续使用仓库内置工具与第一方扩展，不加载外部包。

## 插件源码

从 [`plugins/capability-demo/`](../plugins/capability-demo/) 复制样例，再修改 `plugin.source.json`、HTML、CSS 和 JavaScript。清单声明插件 ID、插件版本、宿主 API 兼容范围、入口文件和请求能力。请求能力必须使用包格式已知的能力 ID；当前宿主只执行其中已实现的能力，其他已知声明会在沙箱启动时被过滤。打包器检查文件类型、路径、大小和清单字段。它不运行插件代码，也不运行 `npm install`。TypeScript 插件可以引用 [`plugins/sdk/it-tools-plugin.d.ts`](../plugins/sdk/it-tools-plugin.d.ts)。

MVP 提供四个宿主能力：读取平台与应用版本、写入文本到系统剪贴板、读取插件设置和保存插件设置。插件通过 `window.itTools.capabilities.runtime.getInfo()`、`window.itTools.capabilities.clipboard.writeText(text)`、`window.itTools.capabilities.settings.get(key)`、`window.itTools.capabilities.settings.set(key, value)` 和 `window.itTools.capabilities.settings.delete(key)` 调用能力。用户授权前，宿主拒绝调用并返回 `PluginApiError`。设置只保存非秘密的基本值，并按插件 ID 命名空间持久化。插件不能继承宿主 preload 或其他插件的数据。网络请求只能访问插件自身来源；主进程会拒绝外部连接。

插件可以创建同源 Dedicated Worker。每个插件窗口最多运行两个 Worker。宿主会在 Worker 创建 30 秒后终止它；Worker 出错或插件窗口关闭时，宿主也会终止它。Worker 不能创建子 Worker、SharedWorker 或 ServiceWorker。Worker 不能访问外部网络。Worker 仍可处理插件自身的数据，不会获得宿主 IPC 或 Node.js。

## 创建签名密钥

使用 Node.js 24 和仓库指定的 pnpm 版本。把密钥放在仓库以外、仅当前用户可访问的目录。密钥目录应有受限 ACL，并保留离线备份。

```powershell
pnpm run plugin:keygen -- --key-id capability-demo-publisher --output-directory "D:\secure-keys\it-tools"
```

命令输出私钥文件路径、公钥文件路径和 SHA-256 指纹。命令不会输出私钥内容。它拒绝把密钥写进仓库，并且不会覆盖已有密钥文件。

## 打包插件

```powershell
pnpm run plugin:pack -- --source plugins/capability-demo --private-key "D:\secure-keys\it-tools\capability-demo-publisher.private.pem" --key-id capability-demo-publisher --output "D:\plugin-build\capability-demo.itplugin"
```

打包器生成确定性的未压缩 ZIP。它把每个文件的 SHA-256 写入签名清单，并用 Ed25519 私钥签名清单。包不包含 `plugin.source.json` 或签名私钥。安装器会再次检查包签名、清单、文件路径和每个文件哈希。

包字段、签名输入、路径规则和安装上限见[插件包格式 v1](08-electron-plugin-package-format-v1.md)。

签名只证明包与该公钥匹配。它不证明插件代码安全。发布者应通过独立渠道提供公钥指纹，并审查插件源码。

## 安装和运行

1. 在 Electron 桌面版的“设置 → Electron 插件包”中输入签名密钥 ID、公钥 PEM 和允许的插件 ID。
2. 对照发布者通过独立渠道提供的指纹，再预览并信任签名者。信任签名者不会自动授予系统能力。
3. 安装 `.itplugin` 包。安装器先验证和暂存资源，再登记已安装版本。
4. 选择能力并点击“运行插件”。桌面确认对话框会再次显示本次授权。
5. 在运行窗口验证插件功能。停止、升级、切换旧版本、撤销签名者和卸载都从设置页面执行。

MVP 的端到端样例会拒绝未授权的剪贴板写入；批准能力后，样例会把用户输入的文本写入宿主能力代理。自动化回归替换系统对话框结果，并将剪贴板写入记录在测试进程内存，因此测试不会改动桌面剪贴板。

## 验证

运行 `pnpm test:plugin-pack` 检查密钥路径、文件覆盖保护、确定性 ZIP、清单签名、文件哈希和不支持的能力。运行 `pnpm test:e2e:electron electron/plugin-sandbox.e2e.spec.ts electron/plugin-manager.e2e.spec.ts --reporter=list` 检查沙箱、网络、文件、能力授权、版本回退和插件生命周期。`pnpm check` 会运行打包测试。

MVP 不包括插件商店、Web/Docker 外部插件、嵌套 Worker、任意网络代理或生产签名者名单。插件 Worker 的创建数、生命周期、同源范围和跨平台行为由自动化验收。
