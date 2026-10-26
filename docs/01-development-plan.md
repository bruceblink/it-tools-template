# IT Tools 最新开发计划

> 状态：现行计划
> 更新日期：2026-10-27
> 当前基线：`main`；当前平台和插件工作范围见本计划与性能扩展计划
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

详细性能、扩展和插件路线见 [07-performance-extensibility-plan.md](07-performance-extensibility-plan.md)。
数据库和系统监视的具体页面与服务边界见 [13-database-system-monitor-plan.md](13-database-system-monitor-plan.md)。已交付工具和工作台功能进入维护状态；只有已知缺陷或性能数据支持时才改动这些功能。

| 顺序 | ID | 范围 | 完成标志 |
|---|---|---|---|
| P0 | PLATFORM-ISSUES-001 | 修复平台已知问题并补齐跨平台证据 | 每个问题有复现条件、回归测试和平台覆盖记录 |
| P1 | PLUGIN-API-V1-001 | 设计并验证版本化插件开发接口 | 样例插件使用稳定的清单、工具贡献、能力和设置接口 |
| P2 | PLUGIN-ISOLATION-001 | 完成插件资源、生命周期和平台隔离 | 权限、Worker、失败恢复和停用边界在 Windows/Linux/macOS 通过回归 |
| P3 | PERFORMANCE-BASELINE-001 | 维护性能基线并修复有数据支持的回退 | 固定输入和运行环境可复现；有明确平台与测量范围 |
| P4 | RELEASE-WEB-ELECTRON-001 | 按维护需要发布 Web、PWA 和 Electron 版本 | 发布包含已验证的构建、权限拒绝、升级和回滚证据 |

不在当前主线上增加新的内置工具或工作台协议。跨项目仍保持独立，不共享进程、运行时、代码包或接口协议。

当前进度（2026-10-25）：API、Git、对象存储和容器工作台的已交付范围进入维护状态。对象存储支持 S3 兼容 Bucket 连接、分页、前缀筛选、受限文本预览，以及文件上传、下载和单对象删除；详见[对象存储首片计划](15-object-storage-workbench-plan.md)和[对象存储传输计划](16-object-storage-transfers-plan.md)。Electron 容器页面只读列出最多 100 个本机容器；Docker 请求限制为 10 秒和 512 KiB。Web 不注册该页面。范围与回滚记录见[容器工作台首片计划](17-container-workbench-plan.md)。后续只按已知问题和测量证据维护这些功能。

性能优化进度（2026-10-25）：P2 对 Markdown 转 HTML 的同步解析做了 256 KiB 合成输入测量。Windows 11、Node.js 24.15.0、AMD Ryzen 9 5900X 上，单次渲染中位数为 28.04 毫秒，10 次测量最大值为 38.91 毫秒。工具现用专用 Worker，并限制输入为 256 KiB、HTML 输出为 2 MiB、运行时间为 10 秒；新输入会取消旧任务。完整检查、Chromium Web 和隐藏 Electron `app://bundle` 回归通过，Web 首屏 JavaScript gzip 为 299.82 KiB，低于 300 KiB 预算 0.18 KiB。详细实现与边界见[性能与插件计划](07-performance-extensibility-plan.md)。

同日评估 CSV 转 Markdown 表格：256 KiB 合成输入的转换中位数为 24.42 毫秒，10 次最大值为 28.32 毫秒；原页面还会单独同步解析 CSV 作验证。转换现由共享 Worker 执行，限制输入 256 KiB、输出 2 MiB、超时 10 秒。共享 CSV 行宽计算也已修复，避免超多行输入触发 `RangeError`。Web 与隐藏 Electron E2E、完整检查通过；首屏 JavaScript gzip 为 299.81 KiB，低于 300 KiB 预算 0.19 KiB。详细实现与测量结果见[性能与插件计划](07-performance-extensibility-plan.md)。

同日优化 Text Statistics：一次字符循环统计字符数、词数和行数，并复用 TextEncoder 计算 UTF-8 字节数，避免为词数和行数创建两个分割数组。Windows 11、Node.js 24.15.0、AMD Ryzen 9 5900X 上，1 MiB 合成输入的中位耗时从 14.61 毫秒降至 3.76 毫秒。完整 `pnpm check` 通过 784 项单测（18 项跳过）；Chromium Web E2E 通过。Firefox 在本机启动失败，真实窗口交互未执行。详细实现和测量方法见[性能与插件计划](07-performance-extensibility-plan.md)。

同日将 Docker Run 转 Compose 改为专用 Worker：合成 256 KiB 命令原本同步运行约 1.46 秒，现由 Worker 处理，并限制输入 256 KiB、输出 2 MiB 和执行时间 10 秒。原有转换结果和诊断消息保持不变。完整 `pnpm check` 通过 790 项单测（18 项跳过）；Chromium Web 与隐藏 Electron `app://bundle` E2E 通过。详细实现与测量方法见[性能与插件计划](07-performance-extensibility-plan.md)。

同日将 List Converter 转为专用 Worker：排序模式下 1 MiB、2 MiB、4 MiB 合成列表的同步转换中位数分别为 31.40、62.61、126.62 毫秒。现在限制输入为 1 MiB、行数为 100,000、结果为 2 MiB、运行时间为 10 秒。完整检查通过 797 项单测（18 项跳过）；Chromium Web 的 4 项 E2E 和隐藏 Electron `app://bundle` 回归通过。详细实现与测量方法见[性能与插件计划](07-performance-extensibility-plan.md)。

同日将 IPv4 CIDR 合并迁入专用 Worker：旧页面对每次输入同步解析两次，分别校验和生成输出。Windows 11、Node.js 24.15.0、AMD Ryzen 9 5900X 上，随机 IPv4 地址输入在 256 KiB 时双次计算中位耗时为 43.22 毫秒，1 MiB 时为 170.56 毫秒。现在只在 Worker 中解析一次，并限制输入 256 KiB、32,768 行、序列化输出 2 MiB 和运行时间 10 秒。验证与详细数据见[性能与插件计划](07-performance-extensibility-plan.md)。

同日将 IPv4 CIDR Overlap Checker 的解析和配对分析迁入 Worker。400 个相同 `/24` 输入的两次同步计算中位耗时为 85.07 毫秒，并产生 79,800 个重叠对。新 Worker 限制输入 256 KiB、1,000 行、500 个重叠对、2 MiB 序列化输出和 10 秒运行时间；超出重叠对上限时清除报告并显示缩小输入的提示。`pnpm check` 通过 43 项脚本测试、815 项单测（18 项跳过）、类型检查、lint、Web/Electron 构建和隔离检查。Chromium 与 WebKit E2E 各 2 项通过；隐藏 Electron CIDR Worker E2E 2 项、插件管理器与沙箱 E2E 2 项通过。Firefox 在本机启动时返回 `spawn UNKNOWN`。详细数据和验证记录见[性能与插件计划](07-performance-extensibility-plan.md)。

同日将 IPv4 CIDR Containment Checker 的规则解析、目标分析和匹配明细生成迁入 Worker。200 条规则与 200 个目标组成的合成输入中，两次同步分析中位耗时为 39.55 毫秒，并产生 40,000 条匹配。Worker 限制两份文本合计 256 KiB、合计 1,000 行、500 条匹配、2 MiB 序列化输出和 10 秒运行时间；超出匹配上限时显示缩小输入提示。对同一密集输入，受限任务在 Vite SSR 基准中的中位耗时为 0.70 毫秒；它只生成错误提示，不生成完整 40,000 条报告，不能与旧分析耗时直接比较。`pnpm check` 通过 43 项脚本测试、825 项单测（18 项跳过）、类型检查、lint、Web/Electron 构建和隔离检查；Chromium、WebKit、隐藏 Electron Worker E2E 各 1 项通过。Firefox 启动返回 `spawn UNKNOWN`。System Monitor E2E 现等待应用首页和搜索按钮就绪后再导航，并为 Windows 临时用户目录清理增加重试。完整 Electron E2E 共 37 项：31 项通过、6 项按环境跳过、0 项失败；System Monitor 定向 E2E 3 项通过。详细验证见[性能与插件计划](07-performance-extensibility-plan.md)。

同日完成当前 `main` 的正式构建性能基线，Web 与 Electron 各测 20 轮，0 轮失败。Web 与 Electron 启动中位数/p95 分别为 759.72/856.93 毫秒和 919.71/1,017.53 毫秒。Electron 本轮使用隐藏窗口，因此其数据不代表真实窗口交互或可见窗口路由响应。详细环境、资源和限制见[20 轮性能基线报告](performance-baseline-2026-10-25-main.json)。16 个本地提交已推送至 `origin/main`，远端与本地一致。

随后优化 IPv4 CIDR splitter：页面复用 `splitIpv4Cidr` 的结果生成文本，不再第二次重建完整子网数组。4096 个 `/32` 子网的 Vite SSR 合成基准中，输出构建中位耗时从 3.56 毫秒降至 1.83 毫秒；输出保持一致。完整 `pnpm check`、Chromium Web E2E 1 项和 Electron `app://bundle` smoke E2E 19 项通过。Windows 打包应用的真实窗口显示了默认输入和 4 个子网结果；窗口输入变更未完成，Computer Use 检测到用户输入后阻止了写入。详细方法和限制见[性能与插件计划](07-performance-extensibility-plan.md)。

随后为 API Client 增加请求预检：渲染器在解析请求头 JSON 和调用 Electron IPC 前限制请求头 JSON 为 128 KiB、URL 为 8 KiB UTF-8 字节、正文为 256 KiB UTF-8 字节。服务单测覆盖多字节边界；Electron E2E 验证超限请求不会抵达本机测试服务器。`pnpm check` 通过 832 项单测（18 项跳过），API Client Electron E2E 1 项通过；Web 首屏 JavaScript gzip 为 299.80 KiB。详细实现和未完成的真实窗口交互说明见[性能与插件计划](07-performance-extensibility-plan.md)。

随后将 cURL Code Generator 的解析和代码生成移入共享 Worker。7,000 个请求头、231,036 字节的合成命令在同步服务路径中位耗时为 28.88 毫秒（21 轮，p95 为 41.79 毫秒）；新页面以 150 毫秒防抖执行所选格式，取消旧任务，保留 256 KiB 输入和 2 MiB 代码输出限制。Chromium Web E2E 4 项、Electron smoke 20 项和完整 `pnpm check` 通过。Windows Electron 真实窗口已验证 GET 摘要、请求头、fetch 与 axios 输出。首屏 JavaScript gzip 为 299.79 KiB。详细方法和限制见[性能与插件计划](07-performance-extensibility-plan.md)。

2026-10-27 完成外部插件工具贡献元数据首片：签名清单支持可选的 `contributions.tools`，插件管理器显示标题、描述和关键词，既有不带该字段的 v1 包继续按原签名载荷验证。宿主为已安装版本生成元数据页面，页面通过现有生命周期接口运行和停止隔离插件窗口；页面不执行外部代码，也不把实现注入宿主工具注册表。样例包、打包脚本、Electron 验证器、生命周期快照、管理器链接、路由操作和 E2E 已同步。Windows 本机 `pnpm check` 通过 137 个测试文件（2 个跳过）、853 项测试（18 项跳过）；完整 Electron E2E 共 39 项，33 项通过、6 项按环境跳过。Linux/macOS 和工具级激活路由仍待后续切片。

2026-10-27 完成工具贡献错误隔离与停用恢复：生命周期快照返回当前 `activeContributionId`，设置页和工具页通过受信 IPC 事件刷新意外关闭、渲染进程崩溃和无响应状态；工具页只停止当前贡献，成功再次运行会清除当前版本的会话故障记录。Windows 本机 `pnpm check` 通过 137 个测试文件（2 个跳过）、856 项测试（18 个跳过）；插件管理器定向 Electron E2E 通过，覆盖贡献切换、停止边界和崩溃恢复提示。Linux/macOS 运行时和公开第三方分发仍待验收。

## 3. 当前基线

项目已有 117 个工具、9 个语言包、Web/PWA 构建、Electron 三平台打包、数据库管理器、
系统监视器和受限插件能力。现有性能、PWA、安全、插件和数据库验收记录继续有效，
但它们不改变新的职责边界。打包成功不等于签名、公证、安装升级、真实设备权限和
完整原生窗口验收完成。

质量基线见 [02-quality-baseline.md](02-quality-baseline.md)，Web/Electron 边界见
[06-web-electron-assessment.md](06-web-electron-assessment.md)，性能与插件细节见
[07-performance-extensibility-plan.md](07-performance-extensibility-plan.md)。
历史阶段从下一节开始保留，作为证据索引，不作为新的并行产品路线。

## 历史阶段一：质量基线（原始窗口 0–30 天）

### 工作内容

- 修复 `vue-tsc`：恢复 `ES2022 + DOM` 类型库，统一从 `vue` 引入 `MaybeRef`，修正 Fuse、figlet、第三方包声明和组件 prop 类型。
- 新增统一 `pnpm check`，依次运行 `typecheck`、`typecheck:app`、`lint --max-warnings 0`、单元测试和生产构建。
- 让 CI、Docker nightly 和 release workflow 使用统一检查。
- 修正 Playwright 版本读取、锁文件安装和浏览器缓存键。
- 增加工具注册完整性检查，验证路径、名称、分类、组件和翻译键。
- 更新 README 中的检查入口和计划链接；发布说明在实际发布时按提交范围生成。

### 验收条件

- 应用类型检查无错误，lint 无 warning。
- 461 个现有单元测试持续通过。
- CI 中 Chromium、Firefox 和 WebKit 的 E2E 测试通过。
- 生产构建无未解释的配置错误或依赖解析警告。

## 历史阶段二：安全与数据边界（原始窗口 31–60 天）

首轮执行 [随机源与敏感输入开发计划](03-security-inputs-plan.md)，分别交付安全随机源和 JWT 签名器敏感输入内存保存。后续按 [内容、HTML 与部署边界计划](04-security-boundaries.md) 检查其他内容输入、HTML 渲染与部署响应头。

### 工作内容

- 引入统一 `RandomSource`，默认使用 Web Crypto；token、OTP secret、随机端口和 UUID 相关逻辑不得使用 `Math.random()`。
- 为随机算法提供可注入测试源，保留可重复的单元测试。
- 敏感工具默认只保存在内存；只有用户明确选择“记住此设备”时才写入 `sessionStorage` 或 `localStorage`。
- 统一 HTML 输出处理，复用 DOMPurify，审查 `v-html`、`innerHTML`、打印窗口和文件下载路径。
- 为 Nginx、Vercel 和 Netlify 增加 CSP、`X-Content-Type-Options`、`Referrer-Policy` 和 frame 防护。
- 增加 XSS、敏感数据持久化和恶意输入回归测试。

### 验收条件

- 安全相关工具展示明确的本地数据策略。
- 随机凭据全部通过 Web Crypto 生成。
- 恶意 Markdown 或 HTML 不执行脚本。
- 各部署入口返回预期安全响应头。

## 历史阶段三：性能与 PWA（原始窗口 61–90 天）

已按 [应用壳与离线缓存计划](05-pwa-cache-plan.md) 交付首片：应用壳预缓存、访问后的静态资源缓存、构建报告与 8 MiB 预缓存预算。300 KiB 首屏 JavaScript、500 KiB 可选入口静态依赖闭包的目标继续保留。随后已完成 Electron 三平台发布；剩余体积与运行时性能工作纳入 [新主线](07-performance-extensibility-plan.md)。

### 工作内容

- 继续使用工具路由懒加载，并进一步拆分 Monaco、mathjs、Tiptap、PDF 和大型数据集。
- 将 `oui-data` 等大型静态资源改为按需加载，避免首次访问或首次安装 PWA 时下载全部数据。
- PWA 只预缓存应用壳和核心资源；工具 chunk 使用运行时缓存，实现访问过的工具离线可用。
- 建立 bundle budget：首屏关键 JavaScript gzip 不超过 300 KB，单个可选工具 chunk gzip 不超过 500 KB，PWA 初始预缓存不超过 8 MB。
- 在 CI 中上传构建体积报告，超过预算时阻止合并。

### 验收条件

- 桌面和移动端首屏加载时间下降。
- 离线应用壳可以启动，已访问工具可以离线打开。
- 构建体积超限能够在 CI 中被发现并阻止合并。

## 原始长期方向与当前承接（历史参考）

- 将工具元数据收敛为统一 `ToolDefinition`，增加 `sensitive`、`offline`、`requiresMedia` 和 `supportsShare` 等能力描述。
- 从工具元数据生成路由、菜单、搜索索引、README 工具清单和翻译覆盖报告。
- 先保证所有语言包的键集合一致，再逐步提升翻译质量；命令面板、错误提示和按钮文本全部纳入 i18n。
- 为明确可公开的非敏感输入与设置评估分享 URL，增加收藏夹导入导出、最近使用工具、常用输入模板、批量处理和结果下载；凭据、文件内容等敏感数据不自动进入 URL。
- 建立键盘导航、焦点恢复、移动端布局、屏幕阅读器标签和颜色对比验收。
- 保持隐私优先、客户端本地运行的产品定位；云端同步、账号和后端服务只有在出现明确需求后再作为可选能力引入。
- [Web 与 Electron 共用界面](06-web-electron-assessment.md) 已完成三平台打包、CI smoke 和公开发布；平台签名、安装升级、原生权限和工具兼容验收继续列为维护项。统一工具定义与插件接口按新计划 P3–P5 推进。

## 测试与发布要求

- 每个阶段先通过单元测试、类型检查、lint 和构建，再提交代码。
- UI 变更使用真实浏览器流程验证首页、搜索、收藏、主题切换、移动菜单和关键工具；无法使用真实窗口时，记录 headless 覆盖范围。
- 发布前执行三浏览器 E2E、PWA 离线验证、Docker 镜像构建和安全响应头检查。
- 每个独立功能完成验证后保持独立提交。提交和推送需由用户请求或明确的仓库流程要求；本轮开发不自动发布。

## 默认假设

- 后续优先级是性能基线、性能改善、扩展接入和受控插件试点；质量与稳定性贯穿各阶段。
- 默认在 `main` 开发；本轮只交付计划，后续实施按阶段另行执行。
- 项目继续采用客户端优先、无需后端的默认部署模式。
- 117 个现有工具作为兼容基线，不进行大规模删除或重命名。
- 项目已采用 AGPLv3，Vue 3、Vite、Naive UI、Pinia 和 pnpm 继续作为基础技术栈。
