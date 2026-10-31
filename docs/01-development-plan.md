# IT Tools 最新开发计划

> 状态：现行计划
> 更新日期：2026-10-29
> 当前基线：`v2026.10.28-1dbc63c`（已发布）；后续 release 进入插件平台化版本序列
> 产品定位：Web/PWA 与 Electron 的通用工具产品和桌面工作台
> 配套项目：[ramag-platform](F:/project/ramag-platform/) 负责少量原生核心能力和 GPUI 客户端

本计划把“好钢用在刀刃上”落实为清晰的产品所有者。it-tools-template 负责用户可见的通用工具、
Electron 工作台、Web/PWA 入口、桌面分发和插件产品；ramag-platform 独立负责少量
Electron 实现成本高或收益低的 Rust/GPUI 原生能力。两个项目不共享进程、运行时、代码包或接口协议。

P0 的共同边界记录见
[双项目能力归属矩阵](14-cross-project-capability-matrix.md)。两个仓库的矩阵必须保持同一
能力 ID、所有者、平台范围和回滚条件。

## 1. 双项目职责

| 范围 | it-tools-template 的责任 | ramag-platform 的责任 |
|---|---|---|
| Web/PWA | 完整承载可移植工具、WASM 和离线策略 | 不提供 Web UI |
| Electron | 完整承载工具路由、数据库、API、Git、消息、容器、对象存储、剪贴板和普通系统监控 | 提供受控原生能力适配 |
| 通用计算 | 117 个工具、格式转换、编码、数据处理和测试样例 | 不复制工具入口；必要时提供可移植核心 |
| SSH/SFTP/PTY | 当前不纳入 it-tools-template 的统一功能范围 | 由 Ramag 独立提供 Rust 会话、PTY、隧道和安全边界 |
| 本地安全存储 | 独立管理应用配置和凭据；不暴露通用 Node 或文件接口 | 独立管理 Ramag 的连接和会话秘密 |
| 高精度系统诊断 | 普通 CPU、内存、磁盘、网络和进程页面 | 只在基准证明 Electron/Node 不满足时提供采集能力 |
| GPUI | 不实现 | 只实现原生核心工作区，不恢复通用工具箱 |

Web、Electron 和 GPUI 的平台范围必须在工具定义中明确。it-tools-template 独立维护
Web/Electron 的参数、权限、错误和资源限制；Ramag 独立维护 GPUI 的原生能力。
两个项目只对照用户场景，不共享实现和运行时。

## 2. 当前主线：平台稳定性与插件开发接口

详细性能、扩展和插件设计见 [07-performance-extensibility-design.md](07-performance-extensibility-design.md)。
数据库和系统监视的具体页面与服务边界见 [13-database-system-monitor-design.md](13-database-system-monitor-design.md)。已交付工具和工作台功能进入维护状态；只有已知缺陷或性能数据支持时才改动这些功能。

| 顺序 | ID | 范围 | 完成标志 |
|---|---|---|---|
| P0 | PLATFORM-ISSUES-001 | 修复平台已知问题并补齐跨平台证据 | 每个问题有复现条件、回归测试和平台覆盖记录 |
| P1 | PLUGIN-API-V1-001 | 设计并验证版本化插件开发接口 | 样例插件使用稳定的清单、工具贡献、能力和设置接口 |
| P2 | PLUGIN-ISOLATION-001 | 完成插件资源、生命周期和平台隔离 | 权限、Worker、失败恢复和停用边界在 Windows/Linux/macOS 通过回归 |
| P3 | PERFORMANCE-BASELINE-001 | 维护性能基线并修复有数据支持的回退 | 固定输入和运行环境可复现；有明确平台与测量范围 |
| P4 | RELEASE-WEB-ELECTRON-001 | 按维护需要发布 Web、PWA 和 Electron 版本 | 发布包含已验证的构建、权限拒绝、升级和回滚证据 |

不在当前主线上增加新的内置工具或工作台协议。跨项目仍保持独立，不共享进程、运行时、代码包或接口协议。

### 当前状态（2026-10-29）

内置工具、数据库、系统监视、对象存储和容器工作台进入维护状态。后续只在有已知缺陷、性能数据或平台验收证据时修改；具体设计和验证记录集中在相关设计文档。

| 领域 | 当前入口 | 当前状态 |
|---|---|---|
| 性能、Web/Electron 边界和插件平台 | [性能与插件平台设计说明](07-performance-extensibility-design.md) | Worker 迁移、构建预算、平台边界和插件平台 v1 的实施记录集中维护；Linux/macOS 前台窗口、真实设备权限和公开第三方分发仍需独立验收 |
| 外部插件接口 | [包格式](08-electron-plugin-package-format-v1.md)、[能力 API](09-electron-plugin-capability-api-v1.md)、[生命周期](10-electron-plugin-lifecycle-v1.md)、[MVP 使用说明](11-electron-plugin-mvp-quickstart.md) | 清单、工具贡献、能力、设置、错误码、生命周期和安装流程已形成版本化接口 |
| Excalidraw 集成评估 | [Excalidraw 集成评估](18-excalidraw-integration-assessment.md) | 本地绘图可作为第一方页面或静态插件；实时协作需要独立服务，当前外部插件网络边界不支持直接连接 |
| 数据库与系统监视 | [设计说明](13-database-system-monitor-design.md) | Electron 专属工作台进入维护，跨平台和真实窗口证据按设计说明补齐 |
| 对象存储与容器 | [对象存储设计说明](15-object-storage-workbench-design.md)、[容器设计说明](17-container-workbench-design.md) | 对象浏览、传输和只读容器列表已合并记录；Web 继续隐藏桌面专属入口 |
| 双项目边界 | [能力归属矩阵](14-cross-project-capability-matrix.md) | it-tools-template 与 Ramag 不共享进程、运行时、代码包或接口协议 |

`v2026.10.28-1dbc63c` 是当前插件平台化工作的发布基线。后续版本必须以该 tag 为祖先，并把插件清单、SDK、能力边界、生命周期、隔离、验证或开发者工具作为主要交付；普通内置工具只有在平台缺陷或性能证据要求时才进入 release。发布前继续使用同一套 Web、Electron、Docker 和跨平台 GitHub Actions 验收。

## 3. 当前基线

项目已有 117 个工具、9 个语言包、Web/PWA 构建、Electron 三平台打包、数据库管理器、
系统监视器和受限插件能力。现有性能、PWA、安全、插件和数据库验收记录继续有效，
但它们不改变新的职责边界。打包成功不等于签名、公证、安装升级、真实设备权限和
完整原生窗口验收完成。

归档质量基线见 [02-quality-baseline.md](archive/02-quality-baseline.md)，Web/Electron 边界与性能、插件细节见
[07-performance-extensibility-design.md](07-performance-extensibility-design.md)。
历史实施只保留索引，不作为新的并行产品路线。

## 历史与归档索引

历史计划只保留索引。详细实施记录已归档，当前主线不重复维护同一组任务。

| 范围 | 状态 | 记录 |
|---|---|---|
| 质量基线 | 已完成 | [归档质量基线](archive/02-quality-baseline.md) |
| 安全随机源与敏感输入 | 已完成 | [归档安全输入计划](archive/03-security-inputs-plan.md) |
| 内容、HTML 与部署边界 | 已完成 | [归档安全边界](archive/04-security-boundaries.md) |
| PWA 应用壳与离线缓存 | 已完成 | [归档 PWA 计划](archive/05-pwa-cache-plan.md) |
| Web/Electron 平台评估 | 已合并到性能与插件设计 | [归档原始评估](archive/06-web-electron-assessment.md) |
| 依赖安全补丁 | 已完成 | [归档依赖补丁记录](archive/12-dependency-security-patches.md) |

历史性能报告和构建报告保留在 `docs/`，只作为当时的测量证据。它们不构成新的开发计划。第一方内部扩展 SDK v0 与外部插件 v1 的职责不同，分别见 [第一方 SDK v0](extension-sdk-v0.md) 和 [08–11 接口说明](08-electron-plugin-package-format-v1.md)。

## 长期边界

- 保持隐私优先和客户端优先部署；云端同步、账号和后端服务只有在出现明确需求后才作为独立能力评估。
- 117 个现有工具作为兼容基线，不进行大规模删除或重命名。
- 共享 Web/Electron 界面、工具注册、翻译和平台适配层；桌面原生能力只通过受限接口提供。
- Ramag 继续独立维护 SSH/SFTP/PTY、隧道和 GPUI 原生能力；两个项目不建立运行时调用关系。

新增工作必须先写清平台范围、权限、错误、取消、资源上限、验证范围和回滚边界。

## 测试与发布要求

- 每个阶段先通过单元测试、类型检查、lint 和构建，再提交代码。
- UI 变更使用真实浏览器流程验证首页、搜索、收藏、主题切换、移动菜单和关键工具；无法使用真实窗口时，记录 headless 覆盖范围。
- 发布前执行三浏览器 E2E、PWA 离线验证、Docker 镜像构建和安全响应头检查。
- 每个独立功能完成验证后保持独立提交。提交和推送需由用户请求或明确的仓库流程要求；本轮开发不自动发布。

## 默认假设

- 后续优先级是性能基线、性能改善、扩展接入和受控插件试点；质量与稳定性贯穿各阶段。
- 默认在 `main` 开发；每个插件平台化切片完成验证后独立提交，发布由已验证的版本序列触发。
- 项目继续采用客户端优先、无需后端的默认部署模式。
- 117 个现有工具作为兼容基线，不进行大规模删除或重命名。
- 项目采用 GPLv3。Vue 3、Vite、Naive UI、Pinia 和 pnpm 继续作为基础技术栈。
