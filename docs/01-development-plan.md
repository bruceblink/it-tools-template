# IT Tools 主线开发计划

> 状态：唯一开发计划
> 更新日期：2026-11-11
> 本次审查源码基线：`ee2d72a`；本次同步增量为 `3010d78..ee2d72a`，重点检查 Release 重定向修复、源码快照解压、开发构建命令和桌面安装接入
> 本次继续验收基线：`6c2287c`；同步 `92a9d95..6c2287c` 后完成 v2 运行时授权、篡改包可见诊断、工作台命令取消和 v2 包安装卸载进行中状态
> 历史安装更新验收基线：`v2026.11.1-1793495127.gca55a2c`；不是当前主线或最新发布状态的证明
> 完整验证基线：2026-11-07 在 Windows、Node `v24.15.0`、pnpm `12.16.1` 执行 `pnpm check`，退出码为 0；147 个测试文件通过、2 个跳过，917 项测试通过、18 项跳过，Web 与 Electron 构建通过
> 历史交付验证：此前记录在 Linux、Node `v24.22.1`、pnpm `12.16.1` 执行 `corepack pnpm check` 通过；该结果不代替本次 Windows 审查或真实 GitHub Release 安装验收
> 插件平台化起点：`v2026.10.28-1dbc63c`；后续版本保留该 tag 的祖先关系
> 适用范围：本仓库的 Web/PWA、Electron、插件接口和发布维护

本文是仓库唯一的主线开发路线和计划，集中维护未完成工作、执行顺序、代码审查结论和验收条件。技术参考文档只描述稳定接口、实现边界和操作方法，不维护第二套路线或待办。已完成计划和逐次开发日志从当前文档中删除；历史细节通过 Git 查询，性能 JSON 和许可证文件作为验证证据继续保留。未批准的 Excalidraw 评估已移至 `docs/archive/`，不属于当前路线。

本次审查覆盖此前的插件平台改动、`3010d78..ee2d72a` 同步增量、`4840998..da1401a` 的嵌入式工作区改动和 `89d3e9d..3ca8169` 的市场及生命周期体验改动。新增验收证据包括源码构建、签名打包、仓库外项目、市场安装、权限预检、沙箱、生命周期、SDK 定向回归和 Electron 窗口布局流程。Electron E2E 使用隔离的 Xorg dummy display；该证据证明 Electron 窗口与渲染器流程可运行，不替代物理桌面人工检查。本次不发布版本，也不监测 GitHub CI。此前的历史审查结论继续保留，但其测试结果不代表当前版本通过验收。

方向调整：当前主线优先投入插件平台的开发闭环和产品打磨。已确认的 macOS 重开窗口、进程排序和快速失败计时器问题进入低优先级维护队列，不阻塞脚手架、SDK/API、宿主管理体验和插件验证工具的建设；涉及安全边界、数据损坏或宿主不可用的问题仍需在发布前完成。

## 1. 产品范围与维护基线

it-tools-template 独立负责 Web/PWA 工具、Electron 工作台、桌面分发和插件平台。ramag-platform 独立维护自身原生能力。两个项目不共享进程、运行时、代码包、接口协议或发布产物；本计划不安排修改 Ramag。

| 范围 | 当前基线 | 维护边界 |
| --- | --- | --- |
| 通用工具 | 117 个工具、9 个语言包、按需路由、平台化工具注册 | 保持现有 URL、收藏和输入输出；只处理有证据的问题 |
| Web/PWA | 应用壳缓存、访问后资源缓存、构建体积检查 | 默认客户端处理；不新增账号、同步或后端服务 |
| Electron 工作台 | 三引擎数据库、系统监视、API、Git、S3 兼容对象浏览与传输、只读容器列表 | 已交付功能进入维护；不把模块名称解释为完整协议或全部操作均已支持 |
| 第一方扩展 | SDK v0、按需激活、命令、设置迁移和数据提供器 | 仅运行项目维护的受信任代码 |
| 外部插件 | 签名包、信任管理、能力授权、工具贡献、设置、升级回退与停用恢复 | 仅支持 Electron；当前宿主 API 为 `1.4.0`；历史三平台自动化记录保留，macOS 重开窗口存在已确认缺陷，手工安装和自然故障仍需补齐 |
| 项目边界 | [能力归属矩阵](14-cross-project-capability-matrix.md) | 该矩阵用于说明边界，不表示其中的目标能力已进入排期 |

不在当前主线新增 Redis、MongoDB、Kafka、MQTT、剪贴板历史、容器写操作或其他内置工具。SSH/SFTP/PTY 不属于本仓库范围。Excalidraw 本地绘图、分享和协作未批准实施，历史评估已归档。现有插件市场提供 GitHub 目录导航和 Release 安装入口；托管插件包、生产签名者分发及 macOS Intel 支持需另行确认范围。

### 桌面自动更新结果

2026-11-01 用户批准为本项目和 LatestNews 分别添加自动更新。两个项目各自维护实现和发布资产。使用现有 GitHub Release，不新增更新服务器。Electron 主进程使用 `electron-updater`，默认自动检查；下载和退出安装由用户操作确认。Windows NSIS、macOS 更新 ZIP 和 Linux AppImage 尝试差分下载，不能使用差分时回退完整包；DEB 下载完整包。

验收：更新状态、设置持久化、重复操作、取消和错误恢复有测试；发布任务保存更新清单和 `.blockmap`，多架构清单不互相覆盖；完成 `pnpm check`、相关 Electron E2E、Windows 打包和真实窗口检查。签名、公证、其他系统安装及真实发布升级按实际证据记录。回退范围是更新入口、依赖和发布配置；不删除用户数据、旧版本安装包或已发布资产。

2026-11-01 结果：`pnpm check` 已通过，含 902 项单元测试；20 项既有 Electron smoke、新增更新设置 E2E 和 Windows NSIS 打包均通过。[正式 Release](https://github.com/bruceblink/it-tools-template/releases/tag/v2026.11.1-1793495127.gca55a2c) 已公开，13 个资产齐全，12 条 SHA-256 与发布资产摘要一致。原构建运行 `41259619285` 的源码、三平台和 Docker 均成功；发布汇总排除打包日志后，由运行 `41263517486` 复用相同标签产物完成发布。

Windows x64 集成使用本次源码构建的旧版本基线 `2026.10.30-e60c009`，并非旧官方安装包原已支持更新。安装到隔离目录后，从正式 Release 完成自动检查、完整包回退、下载取消与重试。准备匹配的旧安装包缓存后，实际差分下载 34,369,889 字节，完整包为 146,205,183 字节，减少约 76.5%；重建包的 SHA-256 为 `808446facb8e877bfe22971dccb7585203155e453d16e9e22fbcd901aadf02cd`，与正式资产一致。

真实窗口确认默认取消有效，普通退出不会安装；再次确认安装后，NSIS 静默替换并自动重启到新版本。更新器重启使用默认用户目录；随后显式使用原隔离用户目录启动，确认两项收藏、文件标记和 `autoCheck=false` 保留，手动检查返回无新版本。原始日志位于本机临时目录 `desktop-update-integration-20261101` 的 `it-tools-report`、`it-tools-restart-report`。这些结果只覆盖 Windows x64；签名、公证及其他系统安装未执行。

### 更新提示和 Web 更新

桌面端在主界面持续显示可用更新及下载进度，并提供下载、取消和安装入口。Web 端在后台检查更新；新版本准备就绪后提示用户保存输入，再由用户确认刷新。验收包括 `pnpm check`、实际 Service Worker 更新和输入保留的浏览器测试、桌面更新 E2E。回退只撤销本项界面、注册逻辑和测试，不清理用户数据。

### macOS 插件启动排查

macOS 插件生命周期重复测试曾在一次回滚窗口中让 `runtime-proof` 停留在 `Checking`，同一提交的其他 macOS 重复和后续运行通过。CI 保留五次重复，并对单次失败自动重试一次；重试仍失败时任务继续失败，同时保留页面和请求诊断。验收需要静态检查和 macOS CI 结果。回退只撤销重试配置，不改插件包和用户数据。

### 发布版本格式

版本使用 `年.月.日-短提交号`，Git 标签加 `v` 前缀，例如 `2026.10.30-e60c009` 和 `v2026.10.30-e60c009`。不再添加时间戳。日期沿用发布脚本的 UTC 日期；同一天的提交号没有时间顺序，发布脚本必须确认新版本按自动更新器的 SemVer 规则高于已有版本，否则停止发布。

## 2. 执行顺序

每次选择一个可独立验收的范围。先修复已交付的市场直装阻塞问题，再把插件平台打磨成“开发者能稳定构建、宿主能清楚管理、失败能诊断恢复”的平台。下面的 P0–P4 是本计划唯一的优先级编号；其他已确认缺陷放入维护队列。

| 顺序 | ID | 当前状态 | 下一项工作 | 完成条件 |
| --- | --- | --- | --- | --- |
| P0 | MARKETPLACE-RELEASE-REDIRECT-001 | 已完成逐跳校验和 GitHub CDN 查询参数兼容；定向测试已覆盖允许和拒绝地址 | 使用真实 GitHub Release 资产和 Electron 窗口完成最终验收 | 带查询参数的 GitHub 资产可安装；未批准地址被拒绝；完成真实窗口安装验收 |
| P0 | PLUGIN-DEVEX-FOUNDATION-001 | 已完成固定提交源码下载、受限 tar.gz 解压、资源边界、源码校验、可选 TypeScript 检查、外部私钥签名、`plugin:build-source` CLI，以及桌面设置中的源码构建、安装、取消、`.itxs` 包格式和 `source-snapshot` 来源记录；市场详情可预填仓库身份；普通 Release 直装仍使用独立流程；Electron 插件流程已通过真实窗口 E2E | 使用真实 GitHub 源码和 Release 资产完成最终安装验收；继续打磨固定 commit 的审查提示 | 新开发者可在仓库外从零完成创建、编写、校验、打包、安装和运行；命令、桌面错误、来源摘要和文档一致；私钥不进入渲染器或源码 |
| P1 | PLUGIN-HOST-UX-001 | Electron 管理器已支持安装、信任、能力授权、贡献工具、停用和卸载；当前外部插件 v1 仍是 legacy HTML/webview 路径，不作为新插件模型；v2 已建立声明式工具类型、宿主工具工作台、RPC 边界、显式取消操作和 v2 包操作状态 | 完成 v2 清单接入、统一工具注册、独立扩展宿主和安装迁移；再完成物理桌面人工检查和 macOS 重开窗口证据 | 新插件只贡献命令、字段、结果和能力声明；宿主统一渲染导航、搜索和工具页；安装、信任、授权、运行、停止、升级回退和卸载均有清晰可见状态 |
| P2 | PLUGIN-SDK-API-001 | API `1.4.0`、五个自包含声明、四项宿主能力、独立项目回归和源码复制交付约定已具备；未执行能力的边界已在能力目录中区分 | 使用真实插件项目完成一次 SDK 升级回归；新增能力前补充权限、资源限制、错误处理和回退说明 | 仓库外项目无需引用内部 `src/` 即可类型检查和打包；版本兼容、能力状态和错误处理有可复制的示例 |
| P3 | PLUGIN-RUNTIME-VALIDATION-001 | 沙箱、签名信任、能力代理、资源上限和生命周期基础实现已存在；目标平台真实窗口验收仍不完整 | 在平台建设稳定后补取消边界、资源诊断、关闭恢复、安装升级和自然故障验证；只扩展有明确权限和资源口径的能力 | Linux、macOS、Windows 的权限、停用、崩溃、卡死、Worker 限额、升级回退和卸载流程都有可追溯证据 |
| P4 | PLUGIN-PUBLISHING-001 | 包格式、本地签名工具、只读 GitHub 插件导航目录和 Electron GitHub Release 直装已交付；直装已有流式校验、进度/取消和来源摘要；生产签名者、公共包目录和自动更新仍未启用 | 整理发布者密钥、可复现构建、包校验、版本兼容和回滚清单；不把源码直载作为普通安装回退 | 可复现生成并审查插件包，发布资产、签名者和回滚步骤可核对；目录只提供仓库和清单参考，不承诺市场托管插件包 |

执行规则：先完成 `MARKETPLACE-RELEASE-REDIRECT-001`，再完成 P0 的开发闭环和 P1 的宿主管理体验；P2 与 P0/P1 联动验收，P3 使用同一套稳定流程补目标平台证据，P4 最后整理发布。维护队列中的问题可在相关代码触及时处理；若影响安全边界、数据完整性或宿主继续使用，立即提升优先级。

## 3. 待处理问题与证据缺口

以下事项来自现有文档和本次源码核对。代码链接以当前审查基线 `3ca8169` 为准；历史报告只证明报告中的版本和环境，不作为当前版本通过验收的证据。

### P0：Release 下载重定向（MARKETPLACE-RELEASE-REDIRECT-001）

- 证据：`electron/plugin-marketplace-download.ts` 使用 `net.request` 手动处理每一跳重定向，允许 GitHub Release CDN 的签名查询参数，并继续校验 HTTPS、主机、端口、凭据和大小。`plugin-marketplace-download.test.ts` 覆盖允许查询参数、未批准主机、重定向上限、取消和流式大小限制。
- 当前影响：代码和受控测试不再因 GitHub CDN 查询参数拒绝地址。真实 GitHub Release `.itxs` 的完整安装和真实 Electron 窗口验收仍未完成。
- 后续验收：使用真实 GitHub Release 资产完成下载、摘要校验、签名安装和临时文件清理；确认未批准地址仍被拒绝。回退只撤销本项下载处理、测试与说明，不删除已安装包。

### P0：插件开发闭环（PLUGIN-DEVEX-FOUNDATION-001）

- 现有基础：`plugin:create` 可以生成源码清单、静态页面和五个自包含 SDK 声明；`plugin:validate`、`plugin:pack` 和 `plugin:keygen` 已有安全边界；`plugins/capability-demo/` 提供能力调用示例；`scripts/plugin-project.test.mjs` 已验证仓库外 TypeScript 项目。
- 主要缺口：真实 GitHub 源码和 Release 资产的完整安装证据仍不完整。Electron 窗口的构建、信任、授权、运行、停止和恢复流程已由 Xorg dummy display 下的 E2E 覆盖；市场详情现在可以把仓库所有者和名称带入源码构建表单；固定 commit 仍需用户核对并填写，签名密钥仍需在桌面端选择。
- 已完成切片：`plugin:build-source` 和桌面源码构建入口固定 commit，流式下载并校验源码快照，拒绝危险 tar 条目，执行源码校验和可选 TypeScript `--noEmit`，使用仓库外 Ed25519 私钥生成并安装 `.itxs`，保存独立的 `source-snapshot` 来源摘要。流程不运行仓库脚本、不安装依赖，也不加载原始源码。
- 下一步：补真实 GitHub Release 资产安装验收，并继续完善固定 commit 的审查提示，不绕过签名、信任和隔离边界。
- 验收：在全新仓库外目录完成一次端到端流程；生成项目能独立类型检查和打包，私钥不写入源码，包能在 Electron 中安装、信任、授权并打开贡献工具；文档和命令输出能让开发者定位失败步骤。

### P1：宿主管理体验（PLUGIN-HOST-UX-001）

- 现有基础：Electron 管理器已经覆盖安装包、签名者信任、能力勾选、贡献工具路由、运行、停止和卸载；能力示例覆盖运行时信息、剪贴板和持久设置。
- 已完成：管理器在无插件的首次使用状态显示“市场 → 信任 → 安装/授权”的三步引导，并提供只读市场入口；能力行和摘要区分宿主支持、下次运行将授权和当前已授权；包卡片显示插件 ID、版本、活动贡献项和错误码。
- 主要缺口：现有 v1 HTML/webview 模型不能提供与原生工具一致的 UI，不能继续作为 v2 默认路径；v2 除 `runtime.info` 外的宿主能力、设置、数据提供者和进程运行时仍未完成。
- 已完成切片：新增 [`docs/22-plugin-architecture-v2.md`](22-plugin-architecture-v2.md)、声明式 v2 清单校验、签名包安装、宿主 `PluginToolWorkbench`、工具与命令注册、设置页管理、WASM 命令执行、可见取消按钮和 v2 包安装/卸载进行中状态。已安装 v2 文件篡改会在列表中显示为无效诊断，执行入口仍会拒绝。主进程限制并发，在超时或取消时请求终止扩展进程，并等待退出后释放运行名额；执行前复核签名文件和入口哈希。`runtime.info` 需要用户逐次批准，其他 v2 能力尚未开放。v1 HTML 包只保留为 legacy 迁移边界。
- 下一步：按实际需求补充其他宿主能力、设置和数据提供者；普通 Node `utilityProcess` 不作为能力沙箱。WASM 线性内存和并发数已有上限，但进程总内存没有跨平台硬配额，需分别评估目标平台资源控制。继续验证停用、卸载、重启、版本切换和跨平台真实窗口行为。
- 验收：新插件不提供 HTML、CSS 或 Vue 组件；安装后工具进入同一导航和搜索索引；打开工具时按需激活扩展宿主；插件异常不阻塞设置页和内置工具。

### P2：SDK 与 API 打磨（PLUGIN-SDK-API-001）

- 现有基础：宿主渲染器 API 为 `1.4.0`，四项能力可执行；五个声明文件可复制到外部项目；错误码和能力目录已有独立回归。
- 主要缺口：SDK 目前以复制声明文件为主，交付形式、版本兼容矩阵和升级说明尚未固定；示例主要覆盖能力调用，缺少 API 不兼容、未授权、停用、恢复和工具贡献的完整模板；已声明但未执行的能力需要明确路线或暂缓承诺。
- 下一步：确定 SDK 的版本化交付方式，整理最小 TypeScript/JavaScript 示例和错误处理模板，维护宿主 API、包格式和 SDK 声明的兼容矩阵；对新增能力先写明用途、权限、资源限制和失败处理。
- 验收：仓库外项目无需引用内部 `src/` 即可类型检查、校验和打包；升级 API 后能明确识别兼容范围；示例覆盖成功、拒绝、超时、停用和恢复。

### P3：运行时验证与能力边界（PLUGIN-RUNTIME-VALIDATION-001）

- 现有基础：包格式校验、签名信任、沙箱、Worker 限额、能力代理、执行时限、停用撤销和升级回退已有实现与定向测试。
- 主要缺口：三平台真实窗口安装、授权、停用、崩溃、卡死、自然故障和升级卸载证据不完整；取消语义、关闭超时后的残留和资源诊断仍需实际平台验证。
- 下一步：先为开发闭环和管理体验建立固定测试数据与测试脚本，再按平台补真实窗口矩阵；只有在权限模型、资源口径和失败恢复明确后，才实现新的文件、摄像头或数据能力。
- 验收：每个平台都有来源、权限、网络、Worker、窗口、进程和清理证据；失败不会使宿主设置或其他插件不可用；新增能力有对应 SDK、UI、审计和回退路径。

### P4：发布者与分发准备（PLUGIN-PUBLISHING-001）

- 现有基础：Ed25519 本地密钥生成、签名包、校验和和版本化安装路径已具备；`/plugin-marketplace` 已提供基于 GitHub topic 的只读仓库导航、清单摘要和源码跳转，但不保存、代理或执行插件包。当前仍没有生产签名者、预构建包、自动更新或公共包分发目录。
- 主要缺口：发布者密钥托管、包复现、资产命名、兼容性检查和回滚清单尚未形成完整的插件发布流程。市场入口只预填仓库身份；commit 和签名密钥仍需显式输入或选择。
- 已有实现：Electron 主进程重新读取仓库 topic、稳定 Release、唯一 `.itxs` 资产和 tag 对应 commit，逐跳检查下载地址与大小，计算下载内容的哈希并复用本地生命周期安装器；仅当 GitHub 元数据提供摘要时才比较该摘要。下载文件保存在临时目录；页面提供进度与下载阶段取消，生命周期在安装根目录外保存可丢失的来源摘要。源码构建命令另行使用固定 commit 和外部签名密钥，不把源码直接载入宿主。
- 来源说明：记录的 commit 是读取 tag 时 GitHub 返回的值，并不能证明发布包由该 commit 构建；tag 和 Release 资产也可能变化。包签名用于验证签名者和包内容，不建立源码与产物之间的关联。修订 [`docs/21-plugin-install-flow.md`](21-plugin-install-flow.md) 中“固定”及验收表述，并在界面或文档中明确来源摘要的限制；如需可验证的构建来源，应另行设计和验收。
- 下一步：整理本地/CI 发布者边界、可复现打包和签名审查清单，补真实窗口验收；在 P0–P3 稳定后单独评估公共包目录、更新和分发策略。
- 验收：同一源码和工具链可复现包内容与签名输入；发布资产、支持的宿主 API、签名者范围和回滚步骤可核对；未批准的分发能力不进入默认流程。

### 维护队列：已确认缺陷与工作台证据

- `MARKETPLACE-OWNER-001`：已关闭。安装器、源码快照、来源记录和市场配置统一接受单字符 GitHub owner；安装器和源码快照回归分别覆盖 owner `A`，并继续保留仓库身份、topic、签名和来源校验。仍需真实 GitHub 仓库资产验收，但单字符 owner 不再被本地格式校验误拒。
- `MAC-REOPEN-001`：代码已区分“关闭主窗口并停止活动插件”和“最终退出应用”。[`electron/main.ts`](../electron/main.ts) 关闭主窗口时调用 `stopExternalPlugins()`，[`electron/plugin-lifecycle.ts`](../electron/plugin-lifecycle.ts) 保留 `shutdown()` 的永久退出语义；当前插件生命周期定向回归和 Linux Xorg dummy display Electron E2E 通过。真实 macOS 从 Dock 重开后的安装、启用、停用和卸载仍未执行，继续作为平台证据缺口，不再作为已确认代码缺陷。
- `MONITOR-SORT-001`：系统监视器会把缺失 CPU 指标的进程排在有效值前面。证据：[`electron/system-monitor/system-info.ts`](../electron/system-monitor/system-info.ts) 的排序调用（142–148 行）交换比较参数，但 `compareMetric()`（220–230 行）的空值顺序没有一起反转。此前调用真实 `normalizeProcessSnapshot()` 复现：`cpu=NaN` 排在 `cpu=80` 前；2,000 条缺失指标与一条 `cpu=99` 的数据经过上限截断后，有效高 CPU 进程被丢弃。前端重新排序无法恢复已丢弃行。修复只调整有效值降序与空值末尾规则，保留 2,000 行上限。验收覆盖有效值与空值混排、CPU 相同后的内存排序、全部空值及超过上限的输入，再检查页面排序和分页。回退只撤销排序与对应测试，不改采集协议。
- 数据库、系统监视、对象存储和容器工作台的完整真实窗口流程尚未统一验收。覆盖连接、分页、筛选、查询、编辑冲突、文件选择、传输确认、取消、断开和关闭；按模块实际支持范围执行。
- 系统监视器需要睡眠恢复、PID 重用和更完整的服务、连接、订阅、监听器及缓存点计数。Windows 已有 30 分钟与 20 次路由切换报告，不能据此推断所有计数均已覆盖。
- PDF 检查已有合成签名与篡改样例；真实外部签名文件和证书链仍缺验证。摄像头需逐平台验证真实设备、授权拒绝后的恢复和设备切换。
- Firefox 此前的定向 E2E 再次因 `spawn UNKNOWN` 启动失败，未取得页面执行结果。后续三浏览器验收需先恢复该运行环境；启动失败或环境跳过均不计为通过。非中英文语言包的完整性仍需单独审查。
- 元标签输出的复制参数已有组件测试，但测试使用 `CopyableStub`，没有经过真实 `TextareaCopyable` 和复制适配器。补充该工具的真实复制链路回归；这属于证据缺口，不是已确认复制失败，不重新安排已完成的输出属性修复。

### 维护队列：API 清理与 SDK 回归

- `API-TIMER-001`：已关闭。[`electron/plugin-api-v1.ts`](../electron/plugin-api-v1.ts) 的请求计时器清理覆盖传输和响应处理，插件 API 定向回归覆盖快速拒绝、读取失败、超时和成功路径；后续维护只保留回归，不再将该项列为待修复缺陷。
- 保持 `plugin:create` 生成项目中的 SDK 声明、API 兼容范围、贡献 ID、能力声明、错误码和使用说明一致。`scripts/plugin-project.test.mjs` 已在仓库外生成项目，完成 TypeScript 声明编译、源码校验和签名打包；此前的 `pnpm check` 包含该回归，不再将独立项目校验列为尚未实现。
- 生成声明继续只使用相对 SDK 引用，不依赖仓库内部 `src/` 路径；新增或修改接口时，同步执行独立项目、`plugin:validate` 与 `plugin:pack` 回归。
- 使用签名样例覆盖不兼容 API、未声明能力、未授权调用、设置迁移、工具级故障、整包停用和恢复；保持第一方 SDK v0 与外部插件 v1 的边界。
- v1 客户端已有覆盖传输与响应体读取的 10 秒超时。宿主已有请求体读取 9 秒上限、执行器 10 秒上限及超时/撤销的 `AbortSignal`。维护这些回归，不重复开发已交付能力；不要把客户端超时等同于宿主副作用已撤销。

### 维护队列：隔离与生命周期验收

- 历史文档记录 Electron CI 运行 `41909808822` 通过 Linux、macOS、Windows，包含 Linux MySQL/SQLite 元数据、三平台 smoke、插件沙箱和 macOS 五次生命周期重复回归。本次没有查询或监测该运行，也没有验证当前提交的三平台 CI；不能将历史结果扩大为当前版本通过。
- Windows 真实窗口已有部分安装、拒绝授权、剪贴板代理和撤销签名者记录，不能代表完整安装到卸载流程。补齐 `runtime.info` 授权、真实系统剪贴板、升级失败回退和卸载操作。
- Linux/macOS 需独立验证插件来源、存储、网络、导航、下载、Worker、卡死和崩溃清理。强制崩溃测试只证明该注入路径；自然故障结果按实际观测记录。
- 已实现的请求时限、执行器超时或授权撤销时的 `AbortSignal`、最多 8 个未结束后台执行、关闭幂等与关闭超时后继续清理，均保留为维护基线。此前插件客户端、能力代理和生命周期定向测试通过 3 个文件、44 项测试；不再将这些实现列为下一项开发。
- `CANCEL-BOUNDARY-001`（待验证风险）：[`electron/plugin-capability-broker.ts`](../electron/plugin-capability-broker.ts) 超大请求体路径在 337–339 行等待 `reader.cancel()`，现有读取期限只覆盖 `reader.read()`。受控流可让取消操作一直等待，但尚未证明 Electron 实际协议请求会出现该行为。先补超限且取消不结束的定向测试，再用真实协议请求核验；没有运行证据前，不扩大为实际漏洞或引入复杂恢复逻辑。
- 取消语义需要准确说明：代理在执行超时或撤销授权时中止执行器，但没有直接监听 `request.signal`；渲染器的传输中止不保证立即停止宿主执行。窗口关闭会撤销能力代理，宿主执行时限仍生效。后续验证客户端超时、窗口关闭、停用和设置写入的实际结果，再决定是否需要额外传播；不能承诺不可取消操作不会产生副作用。
- 补齐关闭超时后的真实窗口残留检查。现有沙箱回归包含 Worker 关闭、宿主关窗清理和下载拒绝；管理器回归包含停止后渲染器 PID 消失，但未覆盖 macOS 主窗口重开后的管理恢复。该缺陷先按 `MAC-REOPEN-001` 修复。
- 资源检查按目标平台记录进程、Worker、定时器、监听器和内存；停用或退出后回到可解释的基线。公开第三方分发前完成目标平台安装与升级验证。
- macOS 曾出现一次回滚窗口 readiness 竞态；当前 CI 保留五次重复并重试一次。插件管理器现在附加回滚 readiness 耗时、页面状态和 bootstrap 错误；重试不能替代根因修复。

### 维护队列：性能复测与优化

- 修复后重新测量冷启动、首次和重复工具导航、输入处理、渲染更新、空闲 CPU、进程组内存和安装体积。Web 使用生产构建，Electron 使用同一提交的解包应用，各至少运行 20 次。2026-11-05 无显示服务环境的无头 Chromium 报告为 [`docs/performance-baseline-2026-11-05-web.json`](performance-baseline-2026-11-05-web.json)：启动中位数 1127.35 ms、p95 1358.4 ms；首次导航中位数 153.1–347.58 ms、p95 197.72–440.89 ms；重复导航中位数 134.77–341.74 ms、p95 165.92–433.6 ms。该次功能 E2E 通过 15/15 项。以上结果属于报告所记环境；本次 Windows 审查没有重跑 20 次基线，不能沿用当时“当前环境没有显示服务”的描述。后续在可用真实桌面或 Linux Xvfb 环境补 Electron 测量。
- Linux/macOS 缺少与 Windows 对应的固定环境基线。真实窗口响应时间与自动化输入耗时分别记录，不能相互替代。
- 系统监视器历史工作集峰值约 115.33 MiB，高于原定 64 MiB 附加内存目标。先明确附加内存计算口径，再定位缓存或采集开销；不能把两种口径直接等同。
- Electron Math Evaluator Worker 历史构建仍高于 500 KiB 候选目标。先测当前产物和实际加载成本，再决定是否继续拆分；Worker 资源单列，不混入工具静态入口预算。
- 继续验证首个工具导航与延后 PWA 注册、懒路由依赖并行加载的实际效果。保留构建检查：8 MiB 应用壳预缓存、300 KiB 首屏 JavaScript gzip、500 KiB 工具新增静态 JavaScript gzip。
- 此前构建有第三方 `js-sha256` 的 `eval`、大块体积、浏览器端 `path`/`tls` 外部化、未匹配 scrollbar 样式和 PWA `inlineDynamicImports` 弃用警告。此前构建已通过；本次未重跑构建。这些提示不直接证明运行失败。先确认实际加载路径和影响，再按受影响功能处理，不通过关闭检查消除提示。

### 维护队列：发布与安装

- `NIGHTLY-MAINT-001`：核对 [Nightly 工作流](../.github/workflows/docker-nightly-release.yml) 8–10 行的全局 `contents: write`、`packages: write`。可见步骤只在镜像推送任务需要包写权限；后续按任务收紧权限，并验证 GHCR 与 Docker Hub 推送不受影响。该项是最小权限维护建议，不是已证实的漏洞。104–113 行注释还把 `--retries=1` 写成重跑整个套件，实际只重试失败测试，需同步改准。回退只撤销权限与说明调整，不改已发布镜像。
- Vite 与 pnpm 的最新稳定版维护继续保留。后续工具链任务必须先核验官方版本、Node 要求和插件兼容范围，再决定是否一起升级；本次没有查询最新版本，也没有修改依赖或锁文件。
- 按 Windows、Linux、macOS 分别记录构建、实际包格式、安装、升级、回滚、卸载和设备权限结果。构建或 smoke 通过不能替代安装和真实窗口验收。
- 复核 Windows NSIS、macOS 签名与公证的实际配置和结果。缺少证书或目标系统时保留未完成状态，不扩大平台支持结论。
- 发布版本保留插件平台化起点的祖先关系；优先交付插件接口、隔离、验证和开发者工具，以及有证据的平台缺陷或性能修复。

## 4. 验证与交付

### 本次审查的本地结果

| 检查 | 结果与适用范围 |
| --- | --- |
| 源码基线 | 历史审查为 `ee2d72a`；本次继续验收为 `da1401a`；Linux、Node `v24.22.1`、pnpm `12.16.1` |
| 插件市场定向回归 | Release 下载、安装器、控制器测试通过；真实 GitHub CDN 查询参数和逐跳重定向由受控响应覆盖 |
| 插件源码构建定向回归 | `pnpm test:plugin-source-build`；4 个文件、37 项测试通过，覆盖 PAX、完整 tar 结束标记、资源上限、路径和链接拒绝、取消、构建编排、单飞控制器和 dispose；插件市场下载/安装、包暂存、来源存储、生命周期和桥接回归 6 个文件、73 项测试通过；`pnpm typecheck:electron`、`pnpm typecheck:app` 和 ESLint 通过 |
| Electron 插件真实窗口回归 | `DISPLAY=:99 pnpm test:e2e:electron electron/plugin-manager.e2e.spec.ts electron/plugin-sandbox.e2e.spec.ts` 通过 2/2（36.2 秒）；`DISPLAY=:100 pnpm test:e2e:electron electron/plugin-manager-layout.e2e.spec.ts` 通过 1/1（33.9 秒）；覆盖安装、信任、能力授权、贡献工具、停止、升级回退、崩溃清理、沙箱网络/Worker 边界和中英文窄窗口布局；使用 Xorg dummy display，不替代物理桌面人工检查 |
| 本次收尾验证 | 重新构建 Web 产物；`pnpm typecheck:app`、`pnpm lint --max-warnings 0`、`git diff --check` 通过；插件市场安装器和源码快照定向回归 21/21 通过；插件市场 Chromium E2E 2/2 通过；WebKit 因环境缺少 GTK 依赖未执行 |
| CLI 启动检查 | `corepack pnpm plugin:build-source -- --help` 正常输出；缺少参数时返回稳定错误和使用说明 |
| owner 核对 | GitHub API 返回单字符用户 `A`；本次未验证该用户有符合市场要求的插件仓库 |
| 旧问题核对 | `MARKETPLACE-OWNER-001`、`API-TIMER-001` 已由实现和定向测试关闭；`MAC-REOPEN-001` 已修复生命周期调度，真实 macOS 重开窗口证据仍缺；`MONITOR-SORT-001` 仍在维护队列 |
| 未完成或不适用 | 完整 `pnpm check`、真实 GitHub Release 安装、Docker 集成、性能测量和物理桌面人工检查未完成；Electron E2E 已在 Xorg dummy display 通过；未查询或监测 CI。 |

自动化和受控响应结果不能代替真实窗口安装验收。历史 Linux 完整检查、Chromium/WebKit 元标签测试和旧问题复现仅适用于当时记录的源码与环境；Firefox 当时因 `spawn UNKNOWN` 未完成，不计为通过。

### 后续变更的验收方法

| 变更范围 | 验证命令或方法 |
| --- | --- |
| 仅 Markdown 整理 | `git diff --check`；检查本地链接、标题锚点、冲突标记、UTF-8 和 LF；运行时和 UI 检查不适用 |
| 应用、构建或接口变更 | `pnpm check`，再执行受影响的定向回归 |
| 插件市场目录 | `pnpm exec vitest run src/modules/plugin-marketplace/plugin-marketplace.service.test.ts`、`pnpm typecheck:app`、`pnpm headers:check`、`pnpm build`；页面通过 GitHub API mock 验证仓库分页、清单摘要、速率限制和不下载插件包 |
| 插件市场直装流程 | `pnpm exec vitest run electron/plugin-marketplace-download.test.ts electron/plugin-marketplace-installer.test.ts electron/plugin-marketplace-controller.test.ts electron/plugin-provenance-store.test.ts electron/plugin-source-snapshot.test.ts --reporter=dot`、`pnpm typecheck:electron`、`pnpm typecheck:app`、`pnpm lint --max-warnings 0`；受控响应验证逐跳地址、大小、摘要、临时文件清理和签名安装；真实 GitHub Release 与 Electron 窗口验收仍待补充；普通模式不允许原始源码直载 |
| 插件平台 P0 开发闭环 | `pnpm test:plugin-source-build`、源码来源和生命周期定向回归、`pnpm typecheck:electron`、`pnpm typecheck:app`；使用 CLI 或桌面设置源码卡片完成固定提交下载、受限解压、校验、可选类型检查、签名打包、安装和来源记录，再信任、授权并运行；真实窗口验收仍待补充 |
| 插件平台 P1/P3 宿主与运行时 | `pnpm test:e2e:electron electron/plugin-manager.e2e.spec.ts electron/plugin-sandbox.e2e.spec.ts`；记录安装、信任、能力授权、贡献工具、停止、升级回退、崩溃和清理的真实窗口范围 |
| 维护队列中的缺陷 | `MAC-REOPEN-001`：在 macOS 执行真实重开窗口流程并补平台证据；`MONITOR-SORT-001`：`pnpm exec vitest run electron/system-monitor/system-info.test.ts`；已关闭的 owner 和 API timer 项保留现有回归，发布前纳入适用的 `pnpm check` |
| 插件 CLI 与 SDK | `pnpm test:plugin-scaffold`、`pnpm test:plugin-pack`、`pnpm test:plugin-sdk`、`pnpm test:plugin-project`；复核独立生成项目 |
| Web/PWA | `pnpm test:e2e`；离线定向检查 `pnpm test:e2e src/pwa-cache.e2e.spec.ts` |
| Electron 与插件 | `pnpm test:e2e:electron`；真实窗口优先使用 Computer Use，不可用时记录有限启动、恢复检查和无头测试范围 |
| 数据库集成 | `pnpm test:e2e:postgres`、`pnpm test:e2e:mysql`、`pnpm test:e2e:sqlite`；PostgreSQL 17+、MySQL 8.4+ 使用 WSL 内的本地 Docker，先核验发行版、Docker 状态与端口，再按脚本要求连接；SQLite 使用临时文件 |
| 对象存储与容器 | `pnpm test:e2e:object-storage`、`pnpm test:e2e:container-workbench`；通过 WSL 使用本地 Docker，记录发行版、服务、镜像版本、端口、启动和清理 |
| 系统监视器长时资源 | `pnpm test:e2e:electron electron/system-monitor-resource.e2e.spec.ts`，设置 `IT_TOOLS_SYSTEM_MONITOR_SOAK_MS=1800000`；检查 30 分钟采样和 20 次路由切换 |
| 性能基线 | 先构建当前平台解包应用，再执行 `node scripts/performance-baseline.mjs --runs 20 --platform all --electron-app-dir . --output docs/performance-baseline-YYYY-MM-DD-main.json`；无显示服务时先执行 `pnpm test:e2e --project=chromium src/app.e2e.spec.ts src/pwa-cache.e2e.spec.ts`，再用 `--platform web` 运行同一性能脚本；新建报告，不覆盖历史报告 |
| Docker 与响应头 | 通过 WSL 构建实际目标镜像；按脚本运行环境执行 `pnpm headers:check`、`pnpm headers:docker`，核验 Docker 调用确实到达 WSL 服务；记录镜像和容器清理 |
| 发布 | 使用仓库 release 流程；核对目标提交、CI 任务、包和校验和，按 tag 提交范围生成发布说明 |

外部服务集成无法使用 Docker 时，标记未完成；不能仅因 Windows 缺少 `docker` 命令或 Docker Desktop 就判定不可用，必须先核验 WSL 中的服务。自动化、隐藏窗口、真实窗口、打包、安装和发布证据分别记录。报告包含提交、平台、命令、结果与限制；没有执行的检查写明“不适用”或“未完成”。

## 5. 文档与回滚规则

- 后续任务只在本文维护状态和验收条件。完成事项从待办中移除，必要的使用方法和实现约束更新到对应设计或接口说明；不恢复历史计划副本。
- 每个独立功能完成规定验证后，在当前分支创建一个聚焦的 Conventional Commit。只暂存本功能文件；未经用户要求不推送或发布。
- 每项改动先明确可回退的代码、接口和配置。保留用户数据、凭据、连接和收藏；数据库已提交写入、客户端已安装缓存及已发布版本不能通过 Git 回退自动撤销。
- 文档整理可撤销对应提交。需要追溯旧计划时使用 Git，不在当前目录恢复第二份开发路线。

## 6. 技术参考文档与归档规则

以下文件是当前实现的技术参考，不维护开发顺序、未完成事项或另一套验收表。所有排期、代码审查结论和下一项工作只写在本文。稳定接口变更必须同时更新实现、测试和对应参考说明。

| 文档 | 职责 |
| --- | --- |
| [性能与插件平台设计说明](07-performance-extensibility-design.md) | 平台边界、加载与缓存、任务执行器、插件架构和资源口径 |
| [插件包格式](08-electron-plugin-package-format-v1.md)、[开发 API](09-electron-plugin-capability-api-v1.md)、[生命周期](10-electron-plugin-lifecycle-v1.md)、[使用说明](11-electron-plugin-mvp-quickstart.md) | 外部插件版本化接口和操作方法 |
| [第一方扩展 SDK v0](extension-sdk-v0.md) | 仓库内受信任扩展的接口和限制 |
| [数据库与系统监视器设计](13-database-system-monitor-design.md) | 页面、数据、查询、采集和清理边界 |
| [能力归属矩阵](14-cross-project-capability-matrix.md) | 双项目能力范围和独立实现边界 |
| [对象存储设计](15-object-storage-workbench-design.md)、[容器设计](17-container-workbench-design.md) | 现有工作台范围、资源限制和回退方法 |
| `docs/archive/18-excalidraw-integration-assessment.md` | 已归档的未批准评估，不属于当前开发路线 |
| [桌面应用更新](19-desktop-updates.md) | 自动检查、差分下载、确认安装和发布文件 |
| [插件市场目录](20-plugin-marketplace.md) | GitHub 仓库导航、元数据读取和不存储插件包的边界 |
| [插件市场安装流程](21-plugin-install-flow.md) | GitHub release 直装、开发者源码构建和安装状态边界 |
