# Web 与 Electron 共用界面的评估

评估日期：2026-10-15。实施开始：2026-10-16。评估基于本仓库当前 Vue 应用和本轮安全批次；下文保留原始技术评估，并在末尾记录当前 Electron 试点实现与验收状态。

2026-10-17 状态复核：已完成 [v2026.10.16-08de8e6](https://github.com/bruceblink/it-tools-template/releases/tag/v2026.10.16-08de8e6) 的 Web、Docker 和 Windows/Linux/macOS 桌面分发。打包与 smoke 成功不等于签名、公证、安装升级和真实设备权限验收完成。后续排期以 [性能、扩展接入与插件平台设计说明](07-performance-extensibility-design.md) 为准；下面的原始评估与试点记录用于说明演进过程。

## 结论

同时开发 Web 和 Electron、复用当前 Web 界面具有较高可行性。建议同一仓库维护同一套 Vue 界面和工具逻辑，只增加桌面启动入口、平台适配层与桌面发布流程。无需复制一套桌面组件、工具注册表或翻译。

用户已明确要求在 PWA 首片完成后将主开发切换到 Electron。最初按本文建议进行 Windows 小范围试点，随后扩展到三平台打包与发布。签名、公证、代表工具兼容、系统权限、安装升级与运行时性能仍需逐项验收。

原始“可行性较高”是建立原型前的源码评估结论。目前共享界面与三平台分发已实现，但仍缺少逐工具完整兼容记录，不能据此承诺全部工具直接兼容，也不能给出可信的代码复用百分比。

## 术语与当前证据

- 渲染进程（Renderer）：运行共享 Vue 界面和浏览器工具逻辑，不直接获得 Node 或操作系统权限。
- 主进程（Main Process）：管理桌面窗口、应用生命周期及明确需要的原生能力。
- 预加载脚本（Preload）：通过受限接口连接渲染进程和主进程，不向页面暴露通用 Node 模块。
- 进程间通信（Inter-Process Communication / IPC）：调用有明确参数与返回值的原生操作；不提供任意 Shell、文件路径或网络代理。
- 渐进式 Web 应用（Progressive Web App / PWA）：当前 Web 的安装与离线能力。桌面安装包的更新流程与 PWA Service Worker 更新分别管理。

当前项目注册 117 个工具，使用 Vue、Naive UI、Pinia、UnoCSS 和 vue-i18n。[工具注册表](../src/tools/index.ts) 由 [路由](../src/router.ts) 直接复用，具体工具组件继续懒加载。共享界面初始化位于 [src/app.ts](../src/app.ts)；Web 入口注册 Service Worker，独立桌面渲染入口跳过该步骤。[依赖与脚本](../package.json) 现已包含 Electron 主进程、预加载层和 Windows NSIS 打包配置。

第一方界面代码以浏览器为运行目标。第三方依赖仍存在 Node 分支：生产构建保留 `mime-types` 的 `path`、`pdf-signature-reader` 的 `tls` 外部化提示，以及 `js-sha256` Node 分支的 `eval` 提示。这些提示不证明对应分支已执行或造成故障，但相关功能必须在双端实际验证。不能通过启用渲染器 Node 集成来替代兼容修复。

原始 PWA 构建曾预缓存约 22.8 MiB；应用壳首片已降至约 1.17 MiB，当前预算与剩余优化见 [PWA 实施记录](archive/05-pwa-cache-plan.md)。这些数字都不是 Electron 安装包大小。桌面包还包含运行时；安装体积、启动时间和内存必须在试点中测量。

## 共用范围与平台边界

| 范围 | 建议共用的部分 | 需要分开的部分 |
| --- | --- | --- |
| 界面与工具 | Vue 组件、算法、校验、工具注册、样式、主题、翻译、页面状态 | 桌面窗口菜单等明确的原生入口 |
| 应用启动 | 共享挂载函数和插件初始化 | Web 注册 PWA；桌面由本地协议加载资源，默认不注册 PWA |
| 路由与静态资源 | 同一份路由定义、工具路径和懒加载组件 | Web 保留服务器 SPA 回退；桌面协议处理器提供本地资源与路由回退 |
| 剪贴板和文件 | 优先保留现有浏览器 API 与共享交互 | 仅在需要系统对话框等原生行为时调用平台接口 |
| 权限与外链 | 共享功能提示、拒绝后的界面和错误处理 | Electron 主进程限制导航、新窗口、外链与设备权限 |
| 验证与发布 | 同一提交、锁文件、共享测试和功能验收条件 | Web 部署与各目标操作系统的安装、签名、升级分别验证 |

共享初始化已抽到 `src/app.ts`。桌面原型新增 `electron/main.ts`、`electron/preload.ts`、`electron/security.ts` 和 `electron.vite.config.ts`；安全本地协议提供 SPA 路由回退并阻止越界路径，预加载只暴露只读运行信息 IPC。后续需要文件保存对话框等原生能力时，再新增窄化的平台接口，不暴露任意路径写入。

平台判断和 IPC 调用集中在适配层。共享组件不得散布 Electron 判断，也不应各维护一套工具列表、翻译或业务状态。每次共享变更从同一提交生成 Web 与桌面构建，避免界面和行为分叉。

共用状态代码不代表浏览器和桌面包会共享存储。两端分别保存允许持久化的偏好；内容和凭据继续默认保存在页面内存。账号、云端同步和内容迁移不属于本评估的实施范围。

## 打包与 API 兼容重点

1. 当前 [Vite 基路径](../vite.config.ts) 和路由使用 `/`。建议评估标准、安全的 `app://bundle/` 自定义协议，处理本地资源和深层路由回退。自定义协议的安全上下文、源、CSP、资源路径和 Worker 必须实测；不能只更换 URL 就视为兼容。相对 `base` 与哈希路由可作为更简单的备选，但应使用同一份路由定义。
2. 当前入口无条件注册 PWA。双端应拆分启动动作，桌面资源由安装包和桌面升级流程管理，避免 Service Worker 留下另一套版本缓存。
3. [剪贴板](../src/composable/copy.ts)、文件选择、Blob 下载和文本处理可先保留浏览器实现，验证焦点、取消、覆盖保存和失败提示。原生保存接口需要限制参数、内容大小与可访问路径。
4. [相机录制](../src/tools/camera-recorder/camera-recorder.vue) 使用摄像头、麦克风和 `MediaRecorder`。需验证允许、拒绝、设备切换、WebM 回放、导出与资源停止。
5. [文本差异工具](../src/tools/text-diff/text-diff.vue) 的同源 Worker 需验证打包路径、消息处理和释放。Web Crypto 需要安全上下文，不能通过退回不安全随机源来解决协议配置问题。
6. [ASCII 字体](../src/tools/ascii-text-drawer/ascii-text-drawer.vue) 来自 `unpkg.com`。这类资源必须使用明确的 HTTPS URL，不能依赖自定义协议下的 `//` 相对来源。完整离线试点还需随包提供所需字体，或明确在线功能范围。统计默认关闭；不增加绕过 CSP 或 CORS 的通用网络 IPC。
7. 分别验证 MIME 推断、文件下载、PDF 签名读取与 BIP39 生成，确认第三方包使用正确的浏览器分支。修复或替换不兼容依赖，保留严格 CSP。

Vite 的静态构建和资源基路径支持见 [生产构建文档](https://vite.dev/guide/build)。Electron 的自定义协议与权限注册见 [协议文档](https://www.electronjs.org/docs/latest/api/protocol/)。

## 桌面安全边界

保留 [现有内容隐私与 HTML 净化边界](archive/04-security-boundaries.md)。用户输入的 Markdown、HTML、SVG 和文件仍属于不可信内容。渲染器关闭 Node 集成，启用上下文隔离和沙箱。主进程校验 IPC 发送方、参数和资源范围，不把系统能力直接交给页面。

只允许可信本地应用页面使用所需权限，其他权限默认拒绝。外链经协议和目标校验后交给默认浏览器。当前 Markdown 打印使用空白新窗口，必须与外链分别处理，验证打印内容净化、窗口隔离和生命周期；不能用一条通用“允许新窗口”规则处理全部场景。

这些边界遵循 [Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security/)。本次没有运行 Electron，因此没有桌面权限或 IPC 安全实测结果。

## 必要性与投入条件

当前产品以浏览器本地处理为主，已有 PWA 配置，开发计划也已安排离线和体积优化。未发现已确认的桌面专属需求记录。因此，桌面版的额外收益目前不明确；该判断可以随用户需求变化而调整。

Electron 会增加运行时安全升级、安装包、签名、发布和更新维护。支持多个操作系统还会增加各平台权限、安装与升级验证。先确认能解决 PWA 难以满足的实际需求，再决定投入范围。发布步骤和维护要求见 [分发概览](https://www.electronjs.org/docs/latest/tutorial/distribution-overview)、[代码签名](https://www.electronjs.org/docs/latest/tutorial/code-signing)、[更新流程](https://www.electronjs.org/docs/latest/tutorial/updates) 与 [性能测量](https://www.electronjs.org/docs/latest/tutorial/performance)。

## 最小试点与防分叉验证

先选择 Windows。共用现有界面，以 JSON 工具、Text Diff、文件导入导出和相机录制作为代表场景。只有确认原生能力收益后，再增加平台能力和目标操作系统。

| 阶段 | 构建范围 | 验收条件 |
| --- | --- | --- |
| 每次共享变更 | 同一提交执行 Web 统一检查、三浏览器回归和已建立的 PWA 离线验收 | 注册、翻译、路由、组件和工具行为保持共用 |
| Windows 试点 | 桌面渲染器、主进程与预加载脚本 | 离线启动、深层路由刷新、Worker、剪贴板、文件、媒体允许与拒绝、打印与外链；覆盖上述第三方依赖功能；确认渲染器无 Node 能力 |
| 试点测量 | 相同工具与输入，对比 Web/PWA 和桌面包 | 记录安装体积、冷启动、空闲与使用中的内存；不预设收益数字 |
| 正式发布 | 每个明确支持的操作系统分别构建、签名和升级 | 安装、启动、权限、文件保存、升级、失败恢复和卸载；macOS 分发还需验证签名与公证 |

## 证据限制与后续顺序

本次子代理只读评估，没有添加 Electron 依赖、创建桌面入口、打包、签名或运行原生桌面窗口。README 中的 `https://tools.likanug.app` 取样返回 200，页面含本仓库标识；canonical 仍指向上游，无法证明线上样本对应本地 HEAD。上游 `it-tools.tech` 没有作为本仓库部署证据。

本轮已按用户指示切换到 Windows Electron 试点；桌面构建、无头 smoke、跨平台和真实 Windows 验收结果追加在下方执行记录。Electron 不会通过启用 Renderer Node 集成或放宽 CSP 来绕过兼容问题。

## Electron 实施记录

当前实现：

- 同一套 Vue 界面与 117 个工具路由用于 Web 和 Electron。桌面端独立 HTML 入口直接挂载共享应用，不导入 PWA 注册模块。
- `electron-vite` 分别构建主进程、预加载脚本与共享渲染器；`electron-builder` 配置 Windows NSIS、Linux AppImage/deb、macOS dmg/zip 安装包。
- 安装包使用安全的 `app://bundle/` scheme，启用 secure、standard 与 Fetch API 权限。资源处理器仅返回构建目录内真实文件；不存在的无扩展名路径回退到应用入口，缺失资源返回 404。
- 窗口启用 sandbox、context isolation、webSecurity，关闭 Node integration 与 webview。除摄像头录制工具触发的相机/麦克风请求外，其他权限默认拒绝。媒体请求只接受受信任应用来源下 `/camera-recorder` 主框架的请求；用户点击授权按钮后才发起请求。原生对话框默认拒绝，用户同意后仅在当前窗口内记住授权。只允许主框架从受信任应用页读取只读运行信息；HTTP(S) 和有效 mailto 外链交给系统浏览器，Markdown 打印使用隔离的空白窗口。
- `pnpm check` 全部通过：响应头与 PWA 构建检查、类型检查、零警告 lint、84 个测试文件共 527 项测试，以及 Web/Electron 两种生产构建。Electron 另有 3 项 Linux/Xvfb smoke 通过，覆盖安全应用来源、深层路由刷新和无 Node 能力的隔离打印窗口。
- `.github/workflows/electron-desktop.yml` 为 Windows、Linux、macOS 原生 runner 添加打包和 Electron smoke 矩阵，并上传平台安装包；推送构建和 PR 检查都以 `main` 为目标。macOS 构建使用 runner 原生架构，签名/公证尚未配置。
- GitHub Actions [run #38859016796](https://github.com/bruceblink/it-tools-template/actions/runs/38859016796) 已通过全部平台：Windows x64 NSIS、Linux x64 AppImage/deb（本地包约 185/140 MiB）、macOS ARM64 dmg/zip 均成功构建，Electron smoke tests 通过，三个平台的安装包 artifact 均已上传。CI 明确关闭 electron-builder 的隐式发布行为。
- 安全单元测试覆盖协议路径遍历和符号链接边界、可信来源、外链 scheme、CSP 完整性，以及相机录制工具的媒体权限边界。打印 smoke 替换了阻塞式原生打印对话框，但实际 PDF 打印输出仍待桌面验收。
- 本机 Electron smoke 本轮未能启动。`pnpm test:e2e:electron` 停在 Electron 44.8.0 运行时下载，没有生成运行时文件；本机窗口清单为空。Web 预览已显示相机页的授权按钮，但这不构成 Electron 原生授权对话框验收。

试点尚未完成：应用现已提供受限的相机/麦克风原生授权流程，但实际设备访问、操作系统隐私设置拒绝后的恢复和相机设备切换仍需逐平台验证。文件覆盖保存、媒体录制、Monaco Worker 和第三方 Node 分支也仍需逐项验证。Linux 上的 NSIS 打包曾生成 Windows x64 应用目录和压缩 payload，但因环境未安装 Wine，在最终 Windows 资源编辑步骤失败，未生成 `.exe` 安装器；CI 已改为在 Windows 原生 runner 上构建。平台安装、macOS 签名与公证、更新和卸载验收仍待记录。
