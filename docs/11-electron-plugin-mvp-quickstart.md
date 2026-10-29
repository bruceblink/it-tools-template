# Electron 插件 MVP 使用说明

本文面向维护 IT Tools 插件的开发者和桌面应用用户。当前 MVP 只支持 Electron 桌面版的本地 `.itplugin` 包。Web 和 Docker 版继续使用仓库内置工具与第一方扩展，不加载外部包。

## 插件源码

可以使用脚手架创建新的插件源目录，再按需参考 [`plugins/capability-demo/`](../plugins/capability-demo/) 修改 `plugin.source.json`、HTML、CSS 和 JavaScript：

```powershell
pnpm plugin:create -- --id org.example.my-plugin --name "My plugin"
```

脚手架默认写入 `plugins/org.example.my-plugin`，也可以用 `--directory` 指定仓库外目录。它不会覆盖已有目录，并生成一个插件命名空间内的工具贡献。清单声明插件 ID、插件版本、宿主 API 兼容范围、入口文件和请求能力。请求能力必须使用包格式已知的能力 ID；当前宿主只执行其中已实现的能力，其他已知声明会在沙箱启动时被过滤。打包器检查文件类型、路径、大小和清单字段。它不运行插件代码，也不运行 `npm install`。TypeScript 插件可以复制 [`plugins/sdk/it-tools-plugin.d.ts`](../plugins/sdk/it-tools-plugin.d.ts)、`it-tools-plugin-package.d.ts`、`plugin-capabilities.d.ts`、`plugin-api-version.d.ts` 和 `plugin-api-errors.d.ts`；SDK 目录自包含能力、错误码与版本类型，不要求插件项目解析仓库内部的 `src/` 路径。

## 开发手册约定

### 1. 先确定包身份和 API 范围

包 ID 使用稳定的小写命名空间，例如 `org.example.my-plugin`。包版本使用 `MAJOR.MINOR.PATCH`。当前外部插件渲染器 API 为 `1.4.0`；清单的 `apiVersion` 使用左闭右开范围，并应覆盖 `1.4.0`：

```json
{
  "formatVersion": 1,
  "id": "org.example.my-plugin",
  "name": "My plugin",
  "version": "1.0.0",
  "apiVersion": { "minInclusive": "1.4.0", "maxExclusive": "2.0.0" },
  "entrypoint": "index.html",
  "requestedCapabilities": []
}
```

`formatVersion`、`apiVersion` 和 `window.itTools.apiVersion` 分别表示包格式、宿主兼容范围和 JavaScript API。它们不能互相替代。宿主拒绝不兼容的 API 范围；插件应在运行时记录 `apiVersion`，但不应依赖日期或构建哈希判断兼容性。

### 2. 只声明实际需要的工具和能力

工具贡献 ID 必须以包 ID 开头，例如 `org.example.my-plugin/example-tool`。`contributions.tools` 只描述标题、说明、关键词、数据处理方式、离线状态和工具级能力。它不会把外部实现注册到宿主工具路由，也不会授予能力。

请求能力只写入 `requestedCapabilities`。用户信任签名者后，仍需在设置页选择能力并确认桌面提示。`runtime.info`、`clipboard.write`、`settings.read` 和 `settings.write` 是当前宿主可执行能力；`data.oui`、`device.camera`、`file.read` 和 `file.save` 可以作为已知声明保留，但当前不会获得授权。插件必须能在未取得任一能力时打开并显示可恢复的状态。

### 3. 使用对外运行时 API

插件只通过 `window.itTools` 对接宿主：

| API | 用途 | 失败处理 |
| --- | --- | --- |
| `plugin` | 读取签名包 `id`、`name`、`version` | 只用于显示、日志和设置键命名 |
| `toolId` | 读取当前宿主选择的贡献 ID | 整包启动时为 `undefined`；不要把 URL hash 当作主标识 |
| `tool` | 读取当前贡献的冻结元数据 | 整包启动时为 `undefined`；不能当作能力授权 |
| `permissions` | 查看声明、宿主支持和本次授权 | 只读快照，不会发起授权 |
| `capabilities.runtime.getInfo()` | 读取平台和应用版本 | 处理 `permission-denied`、`plugin-inactive` 和 `capability-failed` |
| `capabilities.clipboard.writeText(text)` | 请求写入文本剪贴板 | 输入最多 16 KiB；未授权时不重试请求 |
| `capabilities.settings.get/set/delete` | 保存非秘密偏好 | 键最多 64 字符，字符串值最多 4 KiB |

贡献页面的 `toolId` 来源优先级是宿主已验证的贡献 ID、`tool.id`、URL hash 回退值。插件不应修改 `window.itTools`，也不应直接调用 `/__it_tools/v1/call`、Electron IPC、Node.js 或宿主 preload。完整请求、响应和错误码见[插件能力 API v1](09-electron-plugin-capability-api-v1.md)。

### 4. 管理状态和资源

插件代码在独立 sandbox renderer 中运行。每个插件窗口最多运行 2 个 Dedicated Worker；每个 Worker 最长 30 秒。Worker 出错、页面关闭或停用时会被终止。插件不能创建 SharedWorker、ServiceWorker、嵌套 Worker、外部网络连接或下载。

插件必须在窗口关闭前释放事件监听器、定时器、Worker 和对象 URL。能力请求应绑定当前页面生命周期；收到 `plugin-inactive` 后停止重试并更新界面。插件设置只保存字符串、有限数字、布尔值或 `null`，不得保存凭据、令牌、文件内容或网络响应。

### 5. 本地接入验收

每个外部插件在交付前应完成以下检查：

- 清单 ID、版本、API 范围、入口和能力声明通过包校验。
- 未信任签名者时安装或运行被拒绝；信任签名者不会自动授予能力。
- 未授权的能力显示可理解的拒绝状态，其他插件功能继续运行。
- 工具贡献 ID 始终位于包命名空间内，`toolId`、`tool` 和 `permissions` 与当前启动上下文一致。
- 停止、窗口关闭、渲染进程崩溃、升级回退和卸载后，宿主设置页仍可用。
- Web 和 Docker 构建显示桌面专属降级提示，不尝试加载 `.itplugin`。

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
