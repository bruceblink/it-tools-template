# IT Tools 主线开发计划

> 状态：唯一开发计划
> 更新日期：2026-11-07
> 本次审查源码基线：`210dd9f`，同步时与 `origin/main` 一致；本次文档提交不改变运行时代码
> 历史安装更新验收基线：`v2026.11.1-1793495127.gca55a2c`；不是当前主线或最新发布状态的证明
> 完整验证基线：2026-11-07 在 Windows、Node `v24.15.0`、pnpm `12.16.1` 执行 `pnpm check`，退出码为 0；147 个测试文件通过、2 个跳过，917 项测试通过、18 项跳过，Web 与 Electron 构建通过
> 插件平台化起点：`v2026.10.28-1dbc63c`；后续版本保留该 tag 的祖先关系
> 适用范围：本仓库的 Web/PWA、Electron、插件接口和发布维护

本文是仓库唯一的主线开发路线和计划，集中维护未完成工作、执行顺序、代码审查结论和验收条件。技术参考文档只描述稳定接口、实现边界和操作方法，不维护第二套路线或待办。已完成计划和逐次开发日志从当前文档中删除；历史细节通过 Git 查询，性能 JSON 和许可证文件作为验证证据继续保留。未批准的 Excalidraw 评估已移至 `docs/archive/`，不属于当前路线。

本次审查覆盖 `bd6b107..210dd9f` 的 28 个远端提交，重点检查插件调用、超时、关闭与恢复、元标签生成器、SDK 独立项目测试和 CI 配置，并补查系统监视器的进程排序。结论区分已确认缺陷、待验证风险和验收缺口。本次只更新计划，不修复运行时代码，不发布版本，也不监测 GitHub CI。

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

不在当前主线新增 Redis、MongoDB、Kafka、MQTT、剪贴板历史、容器写操作或其他内置工具。SSH/SFTP/PTY 不属于本仓库范围。Excalidraw 本地绘图、分享和协作未批准实施，历史评估已归档。插件商店、生产签名者分发及 macOS Intel 支持需另行确认范围。

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

每次选择一个可独立验收的范围。优先修复已确认的问题；接口、隔离、性能和发布工作按依赖推进。下面的 P0–P4 是本计划唯一的优先级编号，不沿用已删除的历史阶段编号。

| 顺序 | ID | 当前状态 | 下一项工作 | 完成条件 |
| --- | --- | --- | --- | --- |
| P0 | PLATFORM-ISSUES-001 | 已确认 macOS 重开窗口和进程排序缺陷 | 依次修复 `MAC-REOPEN-001`、`MONITOR-SORT-001`；每项单独验收、提交 | 重开窗口后插件管理恢复；缺失指标不挤掉有效进程；原有关闭清理和资源上限不退化 |
| P1 | PLUGIN-API-V1-001 | API、SDK 和仓库外项目回归已具备；快速失败时计时器清理不完整 | 修复 `API-TIMER-001`，维护公开声明和签名样例回归 | 成功、传输失败和超时都释放计时器；错误码与公开接口保持兼容 |
| P2 | PLUGIN-ISOLATION-001 | 超时、执行器超时或授权撤销时的 `AbortSignal`、关闭检查和后台执行数量限制已有实现；当前平台验收不完整 | 核验请求取消边界、关闭超时恢复和 macOS 回滚启动问题，再补目标平台安装流程 | 各目标平台覆盖权限拒绝、撤销、停用、卡死、崩溃、Worker 限额、升级回退和卸载；宿主继续可用 |
| P3 | PERFORMANCE-BASELINE-001 | 已有 2026-11-05 无头 Web 报告；当前 Electron 和其他平台需复测 | 固定环境后复测启动、首个工具导航、Worker 与系统监视器资源 | 同一构建、环境和输入可复现；有中位数、p95、资源口径和未覆盖范围；只修复数据支持的回退 |
| P4 | RELEASE-WEB-ELECTRON-001 | 构建通过；CI 权限、安装和签名证据待补 | 先整理 Nightly 权限与重试说明；实际发布时完成第 4 节适用检查 | 权限与实际用途一致；目标提交的产物、校验和、安装升级证据齐全；回滚方法可执行 |

P1 维护现有版本化接口，不重复开发已交付 API。新增能力、协议或兼容行为必须先明确用途、权限、资源限制和失败处理，再进入本表。

执行规则：先完成 P0 两个独立修复，再处理 P1 的计时器清理。之后推进 P2 的定向验证和平台验收；P3 测量必须使用修复后的同一构建。P4 的配置整理可独立验收，但不因此提前发布。下面的问题编号用于跟踪具体事项，不改变 P0–P4 的执行顺序。

## 3. 待处理问题与证据缺口

以下事项来自现有文档和本次源码核对。代码链接均以审查基线 `210dd9f` 为准。历史报告只证明报告中的版本和环境，不作为当前版本通过验收的证据。

### P0：已知问题与现有工作台

- `MAC-REOPEN-001`：macOS 关闭主窗口后，插件管理器永久进入 `shutting-down`。证据：[`electron/main.ts`](../electron/main.ts) 的 `closed` 处理（481–490 行）调用 `stopExternalPlugins()`，而 `activate`（139–142 行）只重建主窗口；[`electron/plugin-lifecycle.ts`](../electron/plugin-lifecycle.ts) 的 `shutdown()`（359–385 行）永久设置关闭状态，后续写操作由 `assertOperational()`（714–720 行）拒绝。macOS 关闭全部窗口后不会退出应用，因此从 Dock 重开后，插件安装、启用、停用和卸载不能恢复，列表仍可读取。该缺陷由完整调用链确认；本机 Windows 没有执行 macOS 真实窗口复现。修复应区分“关闭主窗口并停止活动插件”和“最终退出应用”，保留真正退出时的永久关闭检查。验收：macOS 激活签名插件、关闭主窗口、确认插件进程清理、从 Dock 重开，再执行安装、启用、停用和卸载；补对应 E2E，并确认 Windows/Linux 退出行为不变。回退只撤销本项生命周期调度和测试，不删除插件包、设置或信任记录。
- `MONITOR-SORT-001`：系统监视器会把缺失 CPU 指标的进程排在有效值前面。证据：[`electron/system-monitor/system-info.ts`](../electron/system-monitor/system-info.ts) 的排序调用（142–148 行）交换比较参数，但 `compareMetric()`（220–230 行）的空值顺序没有一起反转。本次调用真实 `normalizeProcessSnapshot()` 复现：`cpu=NaN` 排在 `cpu=80` 前；2,000 条缺失指标与一条 `cpu=99` 的数据经过上限截断后，有效高 CPU 进程被丢弃。前端重新排序无法恢复已丢弃行。修复只调整有效值降序与空值末尾规则，保留 2,000 行上限。验收覆盖有效值与空值混排、CPU 相同后的内存排序、全部空值及超过上限的输入，再检查页面排序和分页。回退只撤销排序与对应测试，不改采集协议。
- 数据库、系统监视、对象存储和容器工作台的完整真实窗口流程尚未统一验收。覆盖连接、分页、筛选、查询、编辑冲突、文件选择、传输确认、取消、断开和关闭；按模块实际支持范围执行。
- 系统监视器需要睡眠恢复、PID 重用和更完整的服务、连接、订阅、监听器及缓存点计数。Windows 已有 30 分钟与 20 次路由切换报告，不能据此推断所有计数均已覆盖。
- PDF 检查已有合成签名与篡改样例；真实外部签名文件和证书链仍缺验证。摄像头需逐平台验证真实设备、授权拒绝后的恢复和设备切换。
- Firefox 本次定向 E2E 再次因 `spawn UNKNOWN` 启动失败，未取得页面执行结果。后续三浏览器验收需先恢复该运行环境；启动失败或环境跳过均不计为通过。非中英文语言包的完整性仍需单独审查。
- 元标签输出的复制参数已有组件测试，但测试使用 `CopyableStub`，没有经过真实 `TextareaCopyable` 和复制适配器。补充该工具的真实复制链路回归；这属于证据缺口，不是已确认复制失败，不重新安排已完成的输出属性修复。

### P1：插件开发接口

- `API-TIMER-001`：插件客户端在 `fetch()` 快速失败时保留 10 秒计时器。证据：[`electron/plugin-api-v1.ts`](../electron/plugin-api-v1.ts) 在 179–181 行创建计时器，196–200 行的失败分支直接抛出；清理只位于第二段 `try/finally`（202–235 行）。本次用真实生成脚本和受控传输失败执行，得到 `transport-error` 后仍有一个待执行计时器。单次影响较小，重复传输失败会增加短时计时器与对象保留；这不是调用永久挂起。修复应让一个 `finally` 覆盖传输和响应处理。验收覆盖成功、快速拒绝、读取失败、超时和无重复清理，并保持错误码不变。回退只撤销请求清理和对应测试。
- 保持 `plugin:create` 生成项目中的 SDK 声明、API 兼容范围、贡献 ID、能力声明、错误码和使用说明一致。`scripts/plugin-project.test.mjs` 已在仓库外生成项目，完成 TypeScript 声明编译、源码校验和签名打包；本次 `pnpm check` 包含该回归，不再将独立项目校验列为尚未实现。
- 生成声明继续只使用相对 SDK 引用，不依赖仓库内部 `src/` 路径；新增或修改接口时，同步执行独立项目、`plugin:validate` 与 `plugin:pack` 回归。
- 使用签名样例覆盖不兼容 API、未声明能力、未授权调用、设置迁移、工具级故障、整包停用和恢复；保持第一方 SDK v0 与外部插件 v1 的边界。
- v1 客户端已有覆盖传输与响应体读取的 10 秒超时。宿主已有请求体读取 9 秒上限、执行器 10 秒上限及超时/撤销的 `AbortSignal`。维护这些回归，不重复开发已交付能力；不要把客户端超时等同于宿主副作用已撤销。

### P2：插件隔离与生命周期

- 历史文档记录 Electron CI 运行 `41909808822` 通过 Linux、macOS、Windows，包含 Linux MySQL/SQLite 元数据、三平台 smoke、插件沙箱和 macOS 五次生命周期重复回归。本次没有查询或监测该运行，也没有验证当前提交的三平台 CI；不能将历史结果扩大为当前版本通过。
- Windows 真实窗口已有部分安装、拒绝授权、剪贴板代理和撤销签名者记录，不能代表完整安装到卸载流程。补齐 `runtime.info` 授权、真实系统剪贴板、升级失败回退和卸载操作。
- Linux/macOS 需独立验证插件来源、存储、网络、导航、下载、Worker、卡死和崩溃清理。强制崩溃测试只证明该注入路径；自然故障结果按实际观测记录。
- 已实现的请求时限、执行器超时或授权撤销时的 `AbortSignal`、最多 8 个未结束后台执行、关闭幂等与关闭超时后继续清理，均保留为维护基线。本次插件客户端、能力代理和生命周期定向测试通过 3 个文件、44 项测试；不再将这些实现列为下一项开发。
- `CANCEL-BOUNDARY-001`（待验证风险）：[`electron/plugin-capability-broker.ts`](../electron/plugin-capability-broker.ts) 超大请求体路径在 337–339 行等待 `reader.cancel()`，现有读取期限只覆盖 `reader.read()`。受控流可让取消操作一直等待，但尚未证明 Electron 实际协议请求会出现该行为。先补超限且取消不结束的定向测试，再用真实协议请求核验；没有运行证据前，不扩大为实际漏洞或引入复杂恢复逻辑。
- 取消语义需要准确说明：代理在执行超时或撤销授权时中止执行器，但没有直接监听 `request.signal`；渲染器的传输中止不保证立即停止宿主执行。窗口关闭会撤销能力代理，宿主执行时限仍生效。后续验证客户端超时、窗口关闭、停用和设置写入的实际结果，再决定是否需要额外传播；不能承诺不可取消操作不会产生副作用。
- 补齐关闭超时后的真实窗口残留检查。现有沙箱回归包含 Worker 关闭、宿主关窗清理和下载拒绝；管理器回归包含停止后渲染器 PID 消失，但未覆盖 macOS 主窗口重开后的管理恢复。该缺陷先按 `MAC-REOPEN-001` 修复。
- 资源检查按目标平台记录进程、Worker、定时器、监听器和内存；停用或退出后回到可解释的基线。公开第三方分发前完成目标平台安装与升级验证。
- macOS 曾出现一次回滚窗口 readiness 竞态；当前 CI 保留五次重复并重试一次。插件管理器现在附加回滚 readiness 耗时、页面状态和 bootstrap 错误；重试不能替代根因修复。

### P3：性能复测与优化

- 修复后重新测量冷启动、首次和重复工具导航、输入处理、渲染更新、空闲 CPU、进程组内存和安装体积。Web 使用生产构建，Electron 使用同一提交的解包应用，各至少运行 20 次。2026-11-05 无显示服务环境的无头 Chromium 报告为 [`docs/performance-baseline-2026-11-05-web.json`](performance-baseline-2026-11-05-web.json)：启动中位数 1127.35 ms、p95 1358.4 ms；首次导航中位数 153.1–347.58 ms、p95 197.72–440.89 ms；重复导航中位数 134.77–341.74 ms、p95 165.92–433.6 ms。该次功能 E2E 通过 15/15 项。以上结果属于报告所记环境；本次 Windows 审查没有重跑 20 次基线，不能沿用当时“当前环境没有显示服务”的描述。后续在可用真实桌面或 Linux Xvfb 环境补 Electron 测量。
- Linux/macOS 缺少与 Windows 对应的固定环境基线。真实窗口响应时间与自动化输入耗时分别记录，不能相互替代。
- 系统监视器历史工作集峰值约 115.33 MiB，高于原定 64 MiB 附加内存目标。先明确附加内存计算口径，再定位缓存或采集开销；不能把两种口径直接等同。
- Electron Math Evaluator Worker 历史构建仍高于 500 KiB 候选目标。先测当前产物和实际加载成本，再决定是否继续拆分；Worker 资源单列，不混入工具静态入口预算。
- 继续验证首个工具导航与延后 PWA 注册、懒路由依赖并行加载的实际效果。保留构建检查：8 MiB 应用壳预缓存、300 KiB 首屏 JavaScript gzip、500 KiB 工具新增静态 JavaScript gzip。
- 本次构建仍有第三方 `js-sha256` 的 `eval`、大块体积、浏览器端 `path`/`tls` 外部化、未匹配 scrollbar 样式和 PWA `inlineDynamicImports` 弃用警告。构建已通过；这些提示不直接证明运行失败。先确认实际加载路径和影响，再按受影响功能处理，不通过关闭检查消除提示。

### P4：发布与安装

- `NIGHTLY-MAINT-001`：核对 [Nightly 工作流](../.github/workflows/docker-nightly-release.yml) 8–10 行的全局 `contents: write`、`packages: write`。可见步骤只在镜像推送任务需要包写权限；后续按任务收紧权限，并验证 GHCR 与 Docker Hub 推送不受影响。该项是最小权限维护建议，不是已证实的漏洞。104–113 行注释还把 `--retries=1` 写成重跑整个套件，实际只重试失败测试，需同步改准。回退只撤销权限与说明调整，不改已发布镜像。
- Vite 与 pnpm 的最新稳定版维护继续保留。后续工具链任务必须先核验官方版本、Node 要求和插件兼容范围，再决定是否一起升级；本次没有查询最新版本，也没有修改依赖或锁文件。
- 按 Windows、Linux、macOS 分别记录构建、实际包格式、安装、升级、回滚、卸载和设备权限结果。构建或 smoke 通过不能替代安装和真实窗口验收。
- 复核 Windows NSIS、macOS 签名与公证的实际配置和结果。缺少证书或目标系统时保留未完成状态，不扩大平台支持结论。
- 发布版本保留插件平台化起点的祖先关系；优先交付插件接口、隔离、验证和开发者工具，以及有证据的平台缺陷或性能修复。

## 4. 验证与交付

### 本次审查的本地结果

| 检查 | 结果与适用范围 |
| --- | --- |
| 远端同步 | 干净的 `main` 从 `bd6b107` 快进到 `210dd9f`，同步 28 个提交；未切换分支 |
| 完整检查 | `pnpm check` 退出码为 0；Windows、Node `v24.15.0`、pnpm `12.16.1`；147 个测试文件通过、2 个跳过，917 项测试通过、18 项跳过；Web、Web 隔离和 Electron 生产构建通过 |
| 插件定向回归 | `pnpm exec vitest run electron/plugin-capability-broker.test.ts electron/plugin-api-v1.test.ts electron/plugin-lifecycle.test.ts --reporter=dot`；3 个文件、44 项测试通过 |
| 元标签定向回归 | 服务和组件单测 5 项通过；分组类型选择 E2E 在 Chromium、WebKit 通过；Firefox 因 `spawn UNKNOWN` 未完成 |
| 已修复事项核对 | `210dd9f` 已用 `generateMetaTags()` 输出 `content`、转义属性值，并覆盖类型切换和复制参数；旧的 `value` 属性问题从 P0 移除 |
| 最小复现实验 | 调用真实进程归一化函数复现空值优先与截断丢行；执行真实插件客户端初始化脚本复现传输失败后仍保留一个计时器；实验未改仓库文件 |
| 未完成或不适用 | 本次未执行完整 Web/Electron E2E、macOS 窗口复现、真实安装升级、Docker 集成和 20 次性能测量；未查询或监测 CI。仅计划变更的运行时和 UI 验收不适用 |

自动化结果不是人工真实窗口验收。上述 18 项跳过测试不计为通过；未完成检查继续保留在计划中。

### 后续变更的验收方法

| 变更范围 | 验证命令或方法 |
| --- | --- |
| 仅 Markdown 整理 | `git diff --check`；检查本地链接、标题锚点、冲突标记、UTF-8 和 LF；运行时和 UI 检查不适用 |
| 应用、构建或接口变更 | `pnpm check`，再执行受影响的定向回归 |
| 本次确认的三个缺陷 | `MAC-REOPEN-001`：macOS 执行 `pnpm test:e2e:electron electron/plugin-sandbox.e2e.spec.ts electron/plugin-manager.e2e.spec.ts`，补重开窗口流程；`MONITOR-SORT-001`：`pnpm exec vitest run electron/system-monitor/system-info.test.ts`；`API-TIMER-001`：`pnpm exec vitest run electron/plugin-api-v1.test.ts`；三项都需要 `pnpm check` |
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
