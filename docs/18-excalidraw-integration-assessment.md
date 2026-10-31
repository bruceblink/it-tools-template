# Excalidraw 集成评估

> 状态：评估结论，不代表已批准实施
> 评估日期：2026-10-29
> 文档整理日期：2026-10-31
> 唯一执行计划：[主线开发计划](01-development-plan.md)
> 适用范围：Web/PWA、Electron、外部插件平台和实时协作服务

## 1. 术语和评估假设

本文把 Excalidraw 分成三个组件。`@excalidraw/excalidraw` 是可嵌入的 React 编辑器包。Excalidraw App 是包含本地保存、分享链接和协作入口的完整应用。`excalidraw-room` 是官方提供的协作服务器示例。

用户所说的“事实共享”按“实时共享”理解，即多个用户同时编辑同一画布，并看到光标、元素变化和在线状态。如果用户只需要只读分享链接，实施范围会更小，见第 4 节。

## 2. 结论

### 2.1 编辑器集成可行

Excalidraw 编辑器可以作为第一方页面或独立插件的静态资源交付。它支持初始场景、变更回调、导出 PNG/SVG、剪贴板和 `.excalidraw` JSON 数据。官方包使用 MIT 许可证，并声明 React 与 React DOM peer dependency。

当前仓库使用 Vue 3。直接把 React 编辑器放入 Vue 主应用需要增加 React 运行时和 Vue 到 React 的生命周期适配。更小的影响范围是先把编辑器作为独立插件页面或独立 Electron 页面运行，宿主只负责路由、文件保存和生命周期。

### 2.2 当前外部插件不能直接实现实时协作

当前插件沙箱只允许 `it-plugin://<plugin-id>` 同源资源。文档 CSP 的 `connect-src` 为 `'self'`，Electron 会拦截 `http:`、`https:`、`ws:`、`wss:` 和 `ftp:` 请求。当前插件能力目录也没有网络能力。因此，插件不能直接连接 `excalidraw-room`、Socket.IO 或其他协作服务。

官方 FAQ 明确说明 `@excalidraw/excalidraw` npm 包不内置协作。协作需要宿主实现通信、冲突处理、参与者状态和文件同步。官方自托管说明还指出，单独自托管 Excalidraw 客户端目前不提供分享和协作功能；官方协作服务仓库只是协作服务器示例。

### 2.3 实时协作需要独立服务

实时协作至少需要以下服务边界：

- 房间创建、加入、离开和过期。
- WebSocket 或 Socket.IO 连接、断线重连和心跳。
- 元素版本、删除操作、冲突合并和全量快照恢复。
- 参与者光标、用户名、在线状态和只读权限。
- 图片和其他二进制文件的保存、大小限制和清理。
- 房间访问控制、分享链接撤销、审计记录和速率限制。
- 房间密钥或其他端到端加密边界。服务端不应默认读取画布内容。

这些职责不属于当前插件能力代理，也不应由插件直接绕过宿主安全边界实现。

### 2.4 Excalidraw App 的实际协作结构

官方完整应用在编辑器包之上增加一层 `Collab` 控制器。它的主要流程如下：

1. 客户端生成随机 `roomId` 和 `roomKey`，把它们放在 URL 的 `#room=<roomId>,<roomKey>` 片段中。片段不会作为 HTTP 请求的一部分发送；官方说明指出，服务端保存的是加密内容，不能只靠房间 ID 解密。
2. `Collab.tsx` 动态加载 `socket.io-client`，连接 `VITE_APP_WS_SERVER_URL`，并通过 `Portal` 加入房间。官方 `excalidraw-room` 项目提供对应的 Socket.IO 房间服务器。
3. 客户端对场景消息加密后发送。远端消息在客户端解密，再按 `INIT`、`UPDATE`、鼠标位置、空闲状态和可视区域等消息类型处理。服务端主要负责房间连接和转发，不负责读取画布内容。
4. 场景合并使用 Excalidraw 自己的元素版本和 `reconcileElements` 算法。客户端过滤不可见的小元素和过期删除元素，并在本地变更、远端变更和定时全量同步之间合并状态。官方讨论明确说明，冲突处理由 Excalidraw 自己的 reconciliation 算法负责。
5. REST 持久化接口保存加密场景快照；图片文件单独加密后上传和读取。`Collab.tsx` 的 `FileManager` 使用同一个房间密钥处理图片，页面关闭前还会尝试保存当前场景。
6. 客户端维护参与者、光标、选中元素、在线/空闲状态和跟随关系。连接失败时，完整应用可以回退到持久化接口，但这不等于实时协作可用。

因此，复用完整协作能力需要同时复用 `Collab`、`Portal`、加密/解密、元素合并、文件管理和持久化协议。单独安装 `@excalidraw/excalidraw` 或只设置 `isCollaborating` 属性不能得到这些能力。

## 3. 集成方案比较

| 方案 | 编辑器 | 实时协作 | 数据边界 | 结论 |
| --- | --- | --- | --- | --- |
| 第一方 Web/Electron 页面 | 直接集成 React 包或独立页面 | 需要新增协作服务和宿主 API | 可由本项目定义 | 适合长期产品化，但需要 React 适配、后端和权限设计 |
| 当前外部插件 | 可以打包静态编辑器 | 当前沙箱不允许网络连接 | 本地静态资源和宿主能力 | 适合先做本地绘图；不适合实时协作 |
| 外部 iframe 或跳转到 `excalidraw.com` | 快速可用 | 由 Excalidraw 服务负责 | 数据离开本应用，跨域通信受限 | 适合临时验证，不适合作为本产品集成 |
| 独立 Excalidraw 服务 | 使用完整应用和协作服务 | 服务端负责协作 | 需要单独部署、认证和存储 | 适合先验证协作需求，但不属于当前插件平台的内置能力 |

## 4. 方案能力与前提

以下是评估选项，不是阶段排期。是否实施以及平台范围只在主线开发计划中确认。

| 选项 | 功能范围 | 必要前提与验证 |
| --- | --- | --- |
| 本地绘图 | 编辑图形，读写 `.excalidraw`，导出 PNG/SVG 和剪贴板内容 | 选择第一方页面或静态插件；确认宿主文件能力、文件大小、损坏和版本错误、React 生命周期、键盘、主题、离线和真实窗口布局 |
| 只读分享 | 生成可读取文档的链接 | 单独确定加密文档服务或对象存储、认证、访问令牌、撤销、过期、图片和隐私边界；会改变当前无后端的部署前提 |
| 实时协作 | 房间、多人编辑、光标、冲突合并和文件同步 | 明确协作服务、连接入口、房间密钥、认证、持久化、删除和降级；本地 Docker WebSocket 集成及目标平台验收 |

当前外部插件没有网络能力，也没有宿主文件读写能力的完整实现。静态编辑器可行不等于上述文件和协作操作均可交付。网络能力若进入开发范围，需定义目的地址、方法、大小、连接生命周期、用户授权和撤销，不能仅放宽 `connect-src`。

## 5. 不建议的做法

- 不把 `excalidraw.com` 直接当作当前插件的运行时依赖。它会引入跨域、数据归属和服务可用性依赖。
- 不在当前外部插件中临时放开 `ws/wss`。这会绕过现有的网络隔离边界，且没有房间权限和审计协议。
- 不直接复制完整 Excalidraw App 的协作代码到插件包。官方 npm 包与完整应用的协作入口不同，复制会形成长期维护分支。
- 不把“签名包可信”解释为“协作数据可信”。签名只说明包来源和完整性，不能替代房间授权和数据保护。

## 6. 尚未确定的集成条件

| 事项 | 当前状态 | 需要的决定 |
| --- | --- | --- |
| “实时共享”还是只读分享 | 本文按实时协作评估 | 明确目标功能 |
| 是否允许新增后端 | 当前默认客户端优先、无后端 | 同意新增协作或文档服务 |
| 数据存储位置 | 当前插件不提供网络或通用存储 | 选择自有服务、对象存储和数据库 |
| 认证和房间权限 | 未定义 | 选择登录、邀请链接、过期和撤销规则 |
| Web 与 Electron 范围 | 当前插件外部包仅 Electron | 决定是否把编辑器做成 Web/Electron 第一方页面 |
| 插件网络能力 | 当前不存在 | 先明确权限和测试，再决定是否纳入主线 |

## 7. 依据

- [Excalidraw FAQ：npm 包不内置协作](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/faq)
- [Excalidraw 开发文档：自托管当前不支持分享和协作](https://docs.excalidraw.com/docs/introduction/development)
- [Excalidraw 包元数据：MIT 许可证和 React peer dependency](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/package.json)
- [Excalidraw 编辑器包属性：初始数据、变更回调和协作状态](https://github.com/excalidraw/excalidraw/blob/master/dev-docs/docs/@excalidraw/excalidraw/api/props/props.mdx)
- [Excalidraw App 协作控制器 `Collab.tsx`](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/collab/Collab.tsx)
- [Excalidraw App 房间链接、加密数据和持久化接口](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/data/index.ts)
- [Excalidraw App 协作实现：房间 ID、房间密钥和 Socket.IO](https://github.com/excalidraw/excalidraw/blob/master/excalidraw-app/collab/Collab.tsx)
- [官方协作服务器示例 `excalidraw-room`](https://github.com/excalidraw/excalidraw-room)
- [当前插件沙箱实现](../electron/plugin-sandbox.ts) 和 [插件能力目录](../src/shared/plugin-capabilities.ts)
