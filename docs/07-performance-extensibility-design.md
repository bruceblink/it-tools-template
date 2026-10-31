# IT Tools 性能与插件平台设计说明

> 状态：现行技术说明
> 更新日期：2026-10-31
> 唯一执行计划：[主线开发计划](01-development-plan.md)
> 适用范围：Web/PWA、Electron、性能、工具注册和插件扩展

本文维护现有结构、资源边界和验证口径。开发顺序、未完成事项和发布验收集中在主线计划。已完成的阶段表、重复路线和逐次实施日志已移除；旧实现过程通过 Git 查询，历史测量 JSON 保持原样。

## 1. 术语与组件职责

| 名称 | English / 标识 | 职责与边界 |
| --- | --- | --- |
| 工具定义 | ToolDefinition | 声明 ID、路径、分类、翻译、平台、输入处理、离线条件和能力需求；不授予权限 |
| 平台适配层 | Platform Adapter | 提供明确的剪贴板、文件和运行信息操作；不提供通用 Node 或 Shell |
| 任务执行器 | Task Runner | 管理计算队列、并发、取消、超时与结果归属；不隔离不可信插件 |
| 第一方扩展 | First-Party Extension | 由本项目审查并随应用构建的代码；使用 SDK v0，不提供第三方隔离 |
| 外部插件 | External Plugin | 用户安装的签名 `.itplugin` 静态包；仅在 Electron 隔离窗口运行 |
| 插件清单 | Plugin Manifest | 声明身份、API 范围、入口、贡献项、请求能力、资源哈希与签名 |
| 扩展宿主 | Extension Host | 管理注册、激活、停用与资源回收；第一方和外部插件各有实现 |
| 能力代理 | Capability Broker | 校验来源、输入、宿主支持和用户授权，再执行受限操作 |
| 应用壳 | Application Shell | 启动 HTML、静态依赖、样式、字体和图标；不含全部动态工具 |

## 2. Web 与 Electron 平台边界

Web/PWA 与 Electron 共享 Vue 组件、工具注册、路由、校验、主题和翻译。平台启动、文件对话框、原生权限、存储、窗口生命周期和发布分别实现。Ramag 是独立产品；两项目不共享运行时、代码、接口协议或发布产物，能力范围见[归属矩阵](14-cross-project-capability-matrix.md)。

| 边界 | Web/PWA | Electron |
| --- | --- | --- |
| 启动与资源 | 浏览器入口、SPA 回退、Service Worker | `app://bundle/` 本地协议，不注册 Web Service Worker |
| 原生操作 | 浏览器 API 和站点权限 | 固定 preload 方法、主进程来源检查和受限桌面服务 |
| 工具注册 | 仅注册支持 Web 的工具 | 可注册数据库、系统监视、API、Git、对象存储和容器工作台 |
| 外部包 | 不安装 `.itplugin` | 校验、信任、授权后在隔离窗口运行 |
| 存储 | 页面内容默认内存；普通偏好可本地保存 | 凭据、插件设置和运行 Session 按各自边界管理，不与 Web 或 Ramag 共享 |

Electron 主窗口保持 sandbox、context isolation、webSecurity 和关闭 Node integration。主进程校验调用来源、主框架、参数和会话归属；不向页面提供任意文件路径、Shell、通用网络代理或数据库驱动。插件不复用应用主窗口的 preload。

## 3. 工具注册与按需加载

[工具注册表](../src/tools/tool-registry.ts)统一检查 ID、路径、别名、分类、平台和能力。路由、导航与搜索使用描述信息，不为建立索引加载工具实现。现有 117 个工具保留 URL、分类、别名和收藏兼容。

工具页面和重型依赖按使用加载。启动、卡片和菜单不批量预加载工具路由。Vite 的 HTML 入口不写入懒路由的预加载依赖；开始动态导入后，当前路由及其 JavaScript 依赖可并行加载。实现见 [应用初始化](../src/app.ts) 和 [Vite 配置](../vite.config.ts)。

翻译按默认回退语言与用户选择加载。OUI 数据按分片读取：Web 离线只保证已缓存的分片，Electron 随包提供数据并按需读取。Text Diff 使用轻量差异结果；富文本只引入当前工具栏使用的扩展；PDF 解析器在选中文件后加载。

[平台适配层](../src/platform-adapter/index.ts)区分成功、不支持、拒绝和失败。文件保存使用安全文件名和临时 Blob URL；媒体预览 URL 由媒体模块管理。工具生成器要求平台、数据处理和离线声明；能力列表按真实需求填写。

## 4. PWA 缓存与构建预算

[Web 入口](../src/main.ts)在应用挂载后延后 8 秒注册 Service Worker，减少首次导航的资源竞争。首次离线使用仍需先在线加载并完成缓存。Electron 使用独立入口，不执行该注册。

[Service Worker](../src/sw.ts)与构建配置采用以下边界：

- 根据入口的静态依赖图生成应用壳预缓存，排除动态工具入口。
- 运行时只缓存本次构建产生的同源资源；请求不带查询参数，响应必须是 HTTP 200 且不是 HTML。
- 每个构建版本和 Service Worker scope 最多缓存 160 项资源，最长 30 天；配额不足时可清理。激活新版时仅删除当前 scope 的旧工具缓存。
- 不缓存用户内容、工具页面 URL、第三方响应或未生成资源。资源缺失保留真实失败，不以应用 HTML 代替脚本。
- 离线能力受资源访问、缓存淘汰和浏览器存储清理影响；页面截图不能证明离线可用。

| 指标 | 构建上限 | 计算范围 |
| --- | --- | --- |
| 应用壳预缓存 | 8 MiB 原始字节 | 去重后的预缓存资源，不等同首次安装总流量 |
| 首屏 JavaScript | 300 KiB gzip | 首页启动所需静态 JavaScript |
| 工具新增静态 JavaScript | 500 KiB gzip | 已载入应用壳后，打开工具新增的静态 JavaScript |
| Worker 与动态资源 | 单列报告 | 不混入静态入口预算；运行成本另测 |

生产构建输出 `dist/bundle-report.json` 并执行预算检查。完整静态依赖闭包包含共享资源，不能直接当作首页切换时的新增下载量。代码分包本身不证明首次可用时间改善。

## 5. 任务执行器与资源归属

[TaskRunner](../src/task-runner/task-runner.ts)默认最多运行两个 Worker。每个工具用 `taskKey` 和输入版本标记请求；新输入替换旧任务，取消或超时终止同步计算，迟到结果不能覆盖新结果。排队、输入、输出与超时限制由任务定义和调用方共同明确。

转换任务复用共享 Worker；SQL、Bcrypt、Math、Markdown、列表、Docker 命令转换、IPv4 CIDR 和整数进制转换等高成本路径使用对应 Worker。具体任务范围以 [任务类型](../src/task-runner/task-runner.types.ts) 和工厂为准，不把其他同步路径一并描述为已迁移。

页面离开时释放本页 Worker、订阅、监听器、计时器、媒体流和对象 URL。动态 import 模块可能保留在 JavaScript 缓存中，因此模块仍存在不等同资源泄漏。资源检查结合重复操作、对象引用、进程计数和堆数据；一次内存回落不能证明没有泄漏。

## 6. 第一方扩展与外部插件

第一方 [SDK v0](extension-sdk-v0.md)在仓库内注册受信任代码，按工具、命令、设置或数据访问事件激活。普通设置使用命名空间和结构版本迁移；迁移失败保留旧记录并采用默认值。该 SDK 的能力声明不约束同进程代码自行访问浏览器 API，不能用于运行不可信包。

外部插件接口分别由[包格式](08-electron-plugin-package-format-v1.md)、[开发 API](09-electron-plugin-capability-api-v1.md)、[生命周期](10-electron-plugin-lifecycle-v1.md)和[使用说明](11-electron-plugin-mvp-quickstart.md)定义，不在本文复制字段和完整限额。当前实现如下：

1. `plugin:create` 生成源码清单、命名空间工具贡献、静态页面和 5 个自包含 SDK 声明；`plugin:validate` 在不读取私钥、不执行插件和不写包的情况下检查源码。
2. `plugin:pack` 复用校验逻辑，使用 Ed25519 签名清单和资源哈希。安装器限制归档大小、文件数量、路径和展开资源；验证后从随机暂存目录切换到版本目录，不执行脚本或 `npm install`。
3. 用户信任签名者后仍需单独授权能力。声明、宿主支持与用户授权是三个集合，签名不证明代码安全。
4. `it-plugin://<plugin-id>/` 使用按包版本隔离的非持久 Session。插件窗口无 Node、无应用 preload，拒绝外部导航、新窗口、下载和直接外部网络。
5. 宿主在插件运行前注入冻结的 `window.itTools`。API 版本来自[统一版本定义](../src/shared/plugin-api-version.ts)，当前为 `1.4.0`。
6. 当前可执行能力仅为 `runtime.info`、`clipboard.write`、`settings.read`、`settings.write`。清单中的文件、摄像头和 OUI 等已知标识不表示宿主已实现，见[能力目录](../src/shared/plugin-capabilities.ts)。
7. 工具贡献与包身份由宿主校验并注入。工具级故障、整包停用、签名者撤销及升级失败有各自恢复边界；旧窗口和旧请求不能保留授权。
8. 宿主限制插件窗口和 Worker，探测无响应与渲染器退出，并清理资源。现有自动化覆盖不能直接扩大为全部目标平台均已通过。

外部插件没有网络能力，不能直接承载实时协作服务。[Excalidraw 评估](18-excalidraw-integration-assessment.md)仅说明集成选项及其前提。

## 7. 输入、渲染与依赖维护

用户输入的凭据、请求、配置、代码和文档默认保存在页面内存，不自动写入 URL 或浏览器存储。普通显示与处理偏好可以保存。秘密数据不能写入扩展普通设置、日志或错误文本。

显示用户 HTML、Markdown 或 SVG 的入口使用经过约束的净化和渲染流程。复制、下载原始结果与在应用中执行内容分别处理。随机数据使用安全随机源，不以 `Math.random()` 替代敏感用途。

部署响应头以 [security-headers.json](../security-headers.json)为源，通过 `pnpm headers:sync` 生成、`pnpm headers:check` 核对。Nginx 实际响应使用本地 Docker 验证，不能用配置文件解析替代。

[pnpm 配置](../pnpm-workspace.yaml)保留 TOML、node-forge、sprintf-js 和 vuedraggable 的本地补丁。依赖扫描结果与实际补丁覆盖分别记录；不能仅删除 `patchedDependencies` 消除维护记录。上游替换须先通过同类输入回归，补丁检查见 `pnpm test:dependency-security` 及对应脚本测试。

## 8. 测量证据与回滚边界

性能报告保存提交、锁文件、平台、运行时、输入和样本。Web 生产构建与 Electron 解包应用各至少运行 20 次，记录中位数、p95、首次和重复操作、CPU 与进程组内存。源码启动、自动化输入、真实窗口和安装包测量使用不同口径，不能直接混合比较。

| 保留的证据 | 用途与限制 |
| --- | --- |
| [2026-10-25 主线基线](performance-baseline-2026-10-25-main.json) | 对应报告中版本的 Web/Electron 测量，不代表当前提交 |
| [系统监视器长时资源](performance-system-monitor-resource-2026-10-24.json) | Windows 30 分钟及路由清理观测，不代表其他平台或全部资源计数 |
| [Worker 保留引用](performance-worker-retainers-2026-10-18.json) | 对应工具和事件目标的引用分析，不覆盖全部页面 |
| [插件渲染器资源](performance-plugin-renderer-2026-10-18.json) | 注入压力与强制崩溃路径，不证明全部自然故障或长期无泄漏 |
| [真实窗口记录](performance-window-2026-10-18.json) | 旧版窗口的有限样本，不能替代当前版本验收 |

其他 `performance-*.json` 和构建报告继续保留原始日期、提交与环境。验证命令和当前缺口统一见[主线计划](01-development-plan.md)，本文不维护另一套待办。

性能改动按加载、数据或任务范围独立回退，保留输入限制。外部插件失败可停用对应包，不影响内置和第一方工具。升级回退恢复旧包；Git 回退不能清除客户端缓存、撤销数据库写入或自动恢复用户配置。已发布 tag 与版本不改写。
