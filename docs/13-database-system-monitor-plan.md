# 数据库管理工具与系统监视器开发计划

制定日期：2026-10-19。源码规划基线：`main` 的 `7320c58`。S0、S1、S2a–S2f、S3、S4、S5 和 S6 已完成，S7a、S7b、S7c 已完成，S8a、S8b、S8c、S8d 已完成。S4 数据库管理工具 MVP 已完成：三引擎支持受限 SQL、分页浏览、筛选、排序、当前页导出、CRUD、带主键和原值冲突检查的单元格编辑、列管理、PostgreSQL 查询取消和本次连接内的查询历史。表数据页及可直接映射到单表的查询结果支持编辑；复杂查询保持只读。S6 在此基础上增加三引擎批量新增与删除草稿、提交预览和有限事务。MySQL 和 SQLite 的同步查询继续使用既有超时边界，界面不显示不受支持的取消按钮。S5 已提供本机 CPU、内存、应用进程指标、有限曲线、采样周期、暂停恢复、断档标记和离开清理。S7a 增加磁盘容量/读写速率和网络接口速率快照；S7b 增加最多 2,000 条的进程列表、名称搜索、CPU/内存排序和分页；S7c 在单调时间断档、计数器重置和路由切换时重置 CPU 基线并保留断档标记，自动化验证 20 次路由切换后的订阅清理。S8a 将 Web 产物扫描接入 `pnpm check`，拒绝数据库驱动、主机采集依赖和桌面 IPC 标记进入 `dist`；S8b 生成 Windows x64 未压缩包，增加打包目录冒烟用例并记录探索性性能基线；S8c 使用本机 Docker PostgreSQL 17、MySQL 8.4 和临时 SQLite 回归服务与 Electron 流程；S8d 记录 Web/Electron 各 20 轮性能基线。性能预算和三平台验收仍归入 S7/S8。总入口见[长期开发计划](01-development-plan.md)，性能和插件基础见[性能与扩展计划](07-performance-extensibility-plan.md)。

## 目标与默认范围

在 IT Tools 中增加两个仅供 Electron 桌面端使用的第一方模块。参考用户提供的 Neon 截图中的信息组织、表格操作和指标卡片，沿用本项目的导航、主题、字体和组件。

| 模块 | 首个可用版本 | 完整 MVP 的完成范围 | 后续扩展 |
| --- | --- | --- | --- |
| 数据库管理工具 | Electron 桌面端支持 PostgreSQL、MySQL、SQLite；提供连接、对象树、分页浏览和结构查看 | 三种数据库均支持受限查询、筛选排序、导出及带冲突检查的记录增删改 | 结构编辑、SSH 隧道、数据库运行监控 |
| 系统监视器 | Electron 本机 CPU、内存、IT Tools 自身进程指标、实时曲线与暂停 | 增加磁盘、网络和本机进程列表，完成资源限制与三平台验收 | 远程主机、告警、长期历史、进程控制 |

数据库 MVP 从首个可用版本开始支持 PostgreSQL、MySQL 和 SQLite。系统监视器先监控运行桌面应用的本机。Neon 截图中的 CPU 和内存属于数据库计算资源；普通数据库连接不能直接提供远程操作系统的全部指标。本机系统监控与数据库运行监控分别建模、分别标记数据来源。

每个工具都按自身声明的平台范围注册。支持 Web 和 Electron 的工具继续在两端显示；仅支持 Electron 的工具不进入 Web/PWA/Docker Web 的首页卡片、导航、搜索结果或可进入路由。数据库管理器和系统监视器当前仅支持 Electron。浏览器直接打开仅桌面工具路径时显示 Not Found。桌面专属驱动和本机采集代码不进入 Web 产物，也不新增网站后端服务。

## 术语与当前基础

| 名称 | English / 标识 | 职责与边界 |
| --- | --- | --- |
| 数据库适配器 | Database Adapter | 封装 PostgreSQL、MySQL 或 SQLite 的连接、元数据、分页、参数绑定和取消；不负责界面 |
| 数据库会话 | Database Session | 持有连接、执行中查询及其归属；不把驱动对象或密码返回界面 |
| 指标采集器 | Metrics Collector | 读取本机指标并计算采样差值；不控制进程或提升权限 |
| 指标快照 | Metrics Snapshot | 携带采样时间、来源、单位、有效状态与数值；缺失值不写成零 |
| 桌面服务进程 | Desktop Service Process | 执行受审查的驱动或采集代码，隔离故障和高成本工作；不等同于第三方插件沙箱 |
| 虚拟表格 | Virtualized Grid | 只渲染可见行列；不替代服务端分页和结果大小限制 |

当前可复用：

- [工具定义](../src/tools/tools.types.ts)、注册、搜索、分类和懒加载路由。
- [基础布局](../src/layouts/base.layout.vue)、固定导航、主题、全局设置和本地化。
- [平台适配层](../src/platform-adapter/index.ts)、[preload](../electron/preload.ts) 与[桌面类型](../src/types/desktop.d.ts)。
- [插件能力代理](../electron/plugin-capability-broker.ts)的来源校验和限额思路，以及现有插件生命周期中的清理经验。
- SQL Formatter 的本地格式化能力。格式化器没有数据库连接或 SQL 执行能力。

当前已有按平台范围过滤工具、桌面路由和宽工作区页面。S2a 已加入临时 PostgreSQL 连接、数据库 utility process、schema/table 列表和表结构读取。S2b 已增加 PostgreSQL 分页预览。每页最多读取 25 行、展示 16 列，每个单元格最多向界面传回 256 个字符。常见有界主键使用游标分页；无主键或不支持该游标的主键使用偏移分页并显示并发变更提示。偏移分页最多读取到 1,000,000 行。S2c 已保存最多 20 个不含密码的 PostgreSQL 连接资料。S2d 已增加请求级 PostgreSQL 预览取消；界面忽略过期请求结果。S2e 已返回主键和索引信息。S2f 已验证 2 MiB 文本、JSON 和 `bytea` 字段截断，序列化的单页结果小于 16 KiB。S3 已增加 MySQL 8.4+ 和用户选择的 SQLite 文件连接，可浏览 schema、表、视图、列及索引。SQLite 通过主进程文件选择器打开；数据库工具现在默认只读，并可在连接前显式启用读写。S4 已支持三引擎单条 `SELECT`、`INSERT`、`UPDATE`、`DELETE`，拒绝 DDL、事务控制、多条语句和参数占位符。写 SQL 需通过系统确认，并在事务中限制最多变更 1,000 行。三引擎表数据页和受限查询结果支持单元格编辑；写入要求完整主键、记录原值并做并发冲突校验。普通表以及单表直列 SELECT 可编辑；视图、无主键表、截断值、二进制字段、联表、聚合和计算列不开放单元格编辑。每页最多返回 25 行、16 列和每格 256 个字符；SQL 输入限制为 16 KiB，偏移最多为 1,000,000。表数据页支持最多 3 个服务端筛选条件和 3 个排序字段，CSV/JSONL 只导出当前页。PostgreSQL SQL 查询支持请求级取消，查询历史只保存在当前连接页面内，最多 20 条，不写入磁盘。系统指标仍待开发。现有插件能力只有 `runtime.info` 与 `clipboard.write`，不包含数据库和主机监控权限。

S1 已让工具的 `platforms` 元数据控制工具注册、首页、导航、搜索和路由。验收需保持 Electron-only 工具在 Web/PWA/Docker Web 中不可发现且不可访问，同时保留双端工具；后续构建继续检查桌面驱动和本机代码不进入 Web 产物。

## 界面与交互

### 共用布局

- 两个模块进入现有工具注册、首页卡片、搜索和侧栏。计划路径为 `/database-manager` 与 `/system-monitor`，在第一片实现前检查冲突。
- 新增可选的宽工作区布局。现有工具布局包含 600px 宽度约束，不直接把全部工具改成宽屏。以桌面最小窗口 820×600 为下限验证，窄窗口将监控卡片改为单列，并允许折叠对象树。
- 保留顶部导航。数据库对象树与结果区各自滚动；系统监视器的工具栏在内容区顶部固定。避免重复滚动条和顶部留白。
- 沿用项目暗色与浅色变量、绿色强调色、统一按钮高度、间距、细滚动条和焦点样式。焦点框只随实际键盘焦点显示。
- 连接编辑使用应用内弹窗或抽屉；普通成功提示使用轻提示。查询错误、连接断开和采样失败在所属区域持续显示，允许重试。
- 首期提供完整中英文。其他语言保留明确的英文回退，并在实施记录中说明覆盖范围。

### 数据库工作区

左侧显示连接、数据库、schema、表和视图。选择其他数据库时建立对应会话，不把数据库切换当作普通 schema 切换。中间工具栏始终显示当前连接名称、数据库、状态和只读或编辑模式，防止操作对象混淆。

以下是最终 MVP 的界面目标；S2 先实现连接、结构和分页浏览，筛选、排序、导出及 SQL 页在 S3 交付。主区设置“数据”“结构”“SQL”页签。数据页包含筛选、排序、列显示、刷新、分页和导出。结构页只读展示列类型、主键、索引、默认值与可空性。SQL 页提供编辑、运行、取消、耗时、返回行数和结果截断状态。错误状态不继续展示上一次成功结果。

长文本、JSON、二进制和 `NULL` 使用不同显示方式。大字段先显示有限预览，用户主动打开后再受限读取。复制值保留原始类型表示；导出明确区分当前页与受限查询结果，不默认导出整张表。

### 系统监视工作区

工具栏显示“本机”、系统信息、刷新周期、暂停、手动刷新和最近成功采样时间。概览展示 CPU、内存、磁盘和网络卡片，下面显示相同时间轴的趋势图；进程页支持搜索及按 CPU、内存排序。

每张卡片显示单位、时间范围和采集状态。首个差值样本显示“采样中”；无权限、平台不支持、睡眠断档与采集失败分别显示状态。暂停后保留已有曲线并标明停止采样，恢复后不连接断档两端制造连续曲线。

## 技术结构与数据边界

下表列出当前已建立和后续计划使用的目录。`src/tools/database-manager/`、`src/platform-adapter/database.ts`、`src/shared/desktop-services/` 和 `electron/database/` 已用于 S2a–S2e；系统采集服务和其余数据库适配器仍待建立。

| 层 | 拟新增位置 | 责任 |
| --- | --- | --- |
| 数据库界面与状态 | `src/tools/database-manager/` | 对象树、表格、编辑草稿、SQL 与结果；敏感内容只保留在页面内存 |
| 系统监视界面 | `src/tools/system-monitor/` | Electron 指标卡片、曲线、进程列表和显示偏好 |
| 桌面调用封装 | `src/platform-adapter/database.ts`、`system-monitor.ts` | 类型化请求、取消与稳定错误映射；由 Electron 独占调用 |
| 数据库服务 | `electron/database/` | 三种数据库的连接配置、凭据存取、适配器、查询与会话清理 |
| 主机采集服务 | `electron/system-monitor/` | 跨平台采集、采样调度、差值计算和有限历史 |
| 边界类型 | `src/shared/desktop-services/` | 请求、响应、错误码、限额与状态；不导入 Node 或驱动实现 |

调用方向：Electron Vue 模块 → 平台适配层 → 固定 preload 方法 → 主进程来源与参数检查 → 对应桌面服务进程。主进程负责授权、凭据存取与进程生命周期。驱动连接、结果处理和成本较高的采集放入独立服务进程，数据库与采集服务互不阻塞。第一片先验证 `utilityProcess` 在当前 Electron、构建及打包方式中的可行性，再固定接口。

数据库驱动和采集依赖按模块启动加载。桌面专属依赖不得进入 Web 产物或公共应用壳。MVP 使用 PostgreSQL `pg`、MySQL `mysql2` 和 Electron 内置 Node `node:sqlite` 访问用户选择的 SQLite 文件。Node 24 将 SQLite API 标为 Release Candidate；S0 必须验证当前 Electron 内置 Node 的模块、数据类型及文件行为。三种适配器共用上层操作，但保留各自的数据类型、事务、标识符和分页差异，不承诺任意 SQL 跨数据库兼容。SQLite 同步调用只在隔离的 utility process 中运行，避免阻塞 Electron 主进程。

CPU 与基本内存采集先评估 Node `os` API；本应用进程信息复用 Electron app metrics。磁盘、网络、全机进程需要另外评估跨平台采集实现。选型记录必须包含权限、打包、维护状态、许可证、命令执行边界和实际开销。采集器不接受用户输入的 shell 命令；如需系统命令，只能使用固定可执行文件和参数数组，并限制耗时、输出与并发。

`app.getAppMetrics()` 只由主进程的统一调度器调用，再把快照交给指标归一化与界面。需要 Electron main API 的轻量读取留在主进程；其他采集进入服务进程。多个页面共享采样，不能各自启动 app metrics 轮询。

### 凭据、来源和会话

1. 只有受信任应用主框架可调用新 IPC。校验发送者、主框架、来源、参数结构、会话归属及操作权限。iframe、插件窗口、过期 ID 和其他窗口不能复用会话。两个工具不在 Web 构建中注册。
2. 密码默认只用于当前会话。用户选择“记住密码”后，才通过 Electron `safeStorage` 加密保存；加密不可用或 Linux 使用 `basic_text` 时禁止记住密码，继续允许内存会话。普通配置与密码密文分开保存，按版本读写并采用原子替换。
3. 密码输入提交后尽快清空。界面不提供从持久存储读回明文的接口。连接串、密码、证书内容、SQL 与查询结果不进入 URL、日志、分析事件、扩展设置或 `localStorage`。普通显示偏好可以保存。MVP 不保存 SQL 历史。
4. 生产连接默认校验证书和主机名。连接失败时不自动关闭 TLS 验证。自定义 CA 通过明确的文件选择流程读取。开发测试中的不加密连接仅用于隔离的本地容器。
5. 每个请求携带会话 ID、请求 ID 和页面代次。取消或切换连接后丢弃旧结果。页面关闭、窗口销毁和应用退出时取消查询并释放连接、监听器与服务进程。普通路由离开后保留非敏感配置，不保留活动查询或编辑草稿。
6. 首期不向第三方插件开放数据库、凭据、进程列表或通用网络接口。后续插件化先抽取受审查的第一方适配器；任何新增外部能力需要另行定义权限、字段脱敏和撤销行为。

服务进程只接收白名单环境变量和受控的标准输出配置，不默认继承全部主进程环境或转发驱动调试输出。密码只能通过会话内的临时 IPC 传入，不放入命令行参数、环境变量或临时文件。

### 查询和编辑

- 工具生成的查询按 PostgreSQL、MySQL 和 SQLite 各自的占位符及标识符引用方式构建，并与读取到的元数据核对。筛选操作符采用有限集合，不拼接用户输入的 SQL 片段。
- SQL 编辑器只接受单条 `SELECT`、`INSERT`、`UPDATE` 或 `DELETE`，拒绝 DDL、事务控制、多语句、参数占位符、危险函数、文件操作和锁操作。连接默认只读，用户连接前须明确启用读写；每条写 SQL 都经原生确认并在事务中执行，变更行数超过 1,000 时回滚。SQLite 读写模式直接作用于用户选定的文件。数据库账号权限仍是最终写入边界。
- 桌面 SQL 服务如果不能在数据库响应进入进程内存前限定单字段字节数，就不开放自由 SQL。优先使用根据表元数据生成的只读查询，并为 PostgreSQL、MySQL 和 SQLite 分别实现并验证字段大小限制。后续自由 SQL 必须先通过同样的单字段内存边界验收。
- 查询同时设置连接、执行、锁等待和空闲事务超时。取消优先发送数据库取消请求；未及时确认时关闭该连接，不把取消后的连接直接放回池中。
- 查询游标按批读取并在达到行数或字节预算时停止。不能先取得无限结果再截断界面。预算必须约束单字段及整个结果进入桌面服务进程的实际分配；行数上限不能限制单个超大字段。
- 如果某个驱动不能证明它在解码前限制大字段，该引擎只开放经过字段投影限制的生成查询。自由 SQL 留到所有支持的引擎都有可验证的单字段内存上限之后，不能只靠显示预览、V8 heap 检查或进程隔离声称响应大小有硬上限。
- 表分页优先使用稳定主键排序及键集分页。无主键时只读浏览，说明并发变化可能导致重复或遗漏；总行数优先显示估计值，精确计数由用户主动触发并受超时限制。
- 单元格编辑仅开放带主键的普通表；视图、无主键表、截断值和二进制值保持只读。查询结果只在能够确认是单表直列投影且结果包含完整主键时开放编辑；联表、别名、聚合和计算结果保持只读。
- 每次单元格更新绑定完整主键及原值，在事务中再次核对原值。匹配不到唯一记录时回滚并报告冲突，不静默覆盖。写 SQL 单独显示目标、语句预览和变更上限；无法确认提交结果时要求重新读取，禁止自动重试。
- 提交期间取消、网络中断或服务进程故障，若无法确认事务结果，显示“提交结果未知”，要求重新读取；禁止自动重试写入。
- 写入范围包括单条 CRUD SQL、受控单元格更新和最多 100 行的结构化批量新增/删除草稿；建表改表、DROP、TRUNCATE、备份恢复和文件批量导入另行排期。

### 采样和资源限制

下表是待验证的默认预算，不是已达成的性能数据。原型验证后才能调整，并在实施记录中说明原因。

一个活动连接配置最多拥有一个逻辑数据库会话。会话最多占两条物理连接，包含短时取消连接；全局最多六条物理连接、三个执行中查询和十二个排队请求。数据库配置最多保存 50 条，每条非敏感配置最多 8 KiB；各字段另有结构校验，密码输入最多 4 KiB。

查询结果先采用固定的 `startQuery`、`readBatch`、`cancelQuery` 方法。界面主动拉取下一批作为背压，每个查询只允许一个未完成的拉取；服务侧最多保留一批待发送数据，每批最多 1 MiB，并暂停游标继续读取。主进程不能预先汇总完整结果。窗口关闭或请求代次变化时撤销查询 ID，清除批次并取消驱动读取。S0 验收必须证明慢消费者和取消不会使缓冲区持续增长。

| 范围 | 初始预算 | 达到限制后的行为 |
| --- | --- | --- |
| 数据库连接 | 最多 3 个活动连接配置，每个最多 2 条连接 | 拒绝额外连接并提示释放现有会话 |
| 查询调度 | 每个会话 1 个前台查询，最多排队 4 个请求 | 返回繁忙；切换目标时取消旧队列 |
| 超时 | 连接 10 秒、查询 10 秒、锁等待 3 秒；取消等待最多 2 秒 | 取消、必要时断开连接，返回稳定错误码 |
| SQL 输入 | 64 KiB；单条语句 | 执行前拒绝超限输入 |
| 表格与结果 | 默认每页 100 行，最多 500 行；查询最多 10,000 行或 8 MiB | 停止读取，明确显示截断；单次 IPC 分批且不超过 1 MiB |
| 单元格与编辑 | 预览最多 64 KiB；编辑批次最多 100 行或 1 MiB | 提示受限预览或拆分批次，不默默丢弃 |
| 采样周期 | CPU/内存 2 秒；磁盘/网络/进程 5 秒；最短 1 秒 | 复用单一采样任务，慢采样不叠加 |
| 指标历史 | 最长 1 小时；最多 64 个活动序列，每序列最多 3,600 点 | 环形覆盖旧样本；15 分钟和 1 小时视图按像素聚合，超限设备按需选择 |
| 进程列表 | 最多 2,000 条有限字段记录，不保存进程历史 | 分页或虚拟渲染，标明截断 |
| 监视器附加内存 | 在约定测试机上，稳定运行后目标不超过 64 MiB | 未达标则压缩缓存、减少字段或降低采集频率 |
| 监视器空载 CPU | 默认刷新下，60 秒平均目标不超过全机 CPU 的 1 个百分点 | 记录机器和计算口径，优化后重测 |

### 桌面端性能与 WebAssembly

- WebAssembly（WASM）是桌面端可选的计算优化手段，不是默认实现。只有性能剖析确认某个已发布桌面功能受 CPU 计算限制，而且算法、内存布局、分块处理或现有 JavaScript 执行器优化仍不足时，才评估 WASM。
- 优先使用 Web Worker 或 Electron `utilityProcess` 隔离长时间计算。WASM 不替代数据库网络 I/O、SQLite 文件 I/O、操作系统指标 API 或数据库驱动。
- 使用相同的代表性输入、机器、运行时和预热流程对比 JavaScript 与 WASM。只有基准显示 p95 CPU 时间至少改善 20%，并且界面响应、取消和错误处理不退化时，才进入实现。记录 p50/p95、峰值内存、冷启动时间、产物 gzip 增量和测量命令。
- 每个 WASM 执行实例的线性内存初始上限为 64 MiB。通过惰性加载控制首屏和工具入口体积；超出既有工具 500 KiB gzip 闭包预算时，必须先重新评估算法与拆分方式。
- WASM 只接收经过大小限制的结构化输入，不直接获得文件系统、数据库凭据、网络或通用主机 API。长计算按有界批次执行并可取消。日志不写入密码、连接串、SQL 或查询结果。
- 若没有符合上述门槛的热点，保留 JavaScript 实现，并把剖析结果记为“不需要 WASM”。不以语言名称或微基准推断生产性能。

监视器没有订阅者时停止采样。页面隐藏或窗口最小化时暂停并标记断档，恢复后重采；不做常驻后台采集。采样使用单调时间计算速率，展示使用墙钟时间。系统睡眠、时间变化、计数器重置和网卡切换均重置差值基线。

CPU 明确区分全机占比、单核占比和本应用进程占比。内存说明操作系统可用值或空闲值的来源；磁盘区分容量和读写速率；网络区分接口累计字节和每秒速率。跨平台无法提供的字段返回 `unsupported`，权限不足返回 `denied`，缺失样本保留空值。进程键包含启动标识，避免 PID 重用混淆；默认不读取命令行、环境变量或打开文件。

## 开发顺序与验收

S0 原型和 S1 入口与页面骨架已完成。两个产品模块仍缺少实际连接和指标功能。估算按一名主开发者计算，包含实现、测试和文档，不含等待外部设备的时间。每行可以拆成多个独立提交；前一片通过验收并提交后，再开始下一片。

| 顺序 | 范围 | 必须交付的验收结果 | 预计工作量 |
| --- | --- | --- | --- |
| S0 | 桌面服务原型与范围冻结（已完成） | PostgreSQL、MySQL 和 Electron 内置 SQLite 的驱动与基础行为；游标、取消、只读模式、字段长度和锁竞争的可行性；`utilityProcess` 消息往返；冻结资源边界、错误与清理模型 | 3–5 人日 |
| S1 | 桌面工具入口与宽工作区（已完成） | Electron 首页、导航、搜索和路由启用两工具；Web/PWA 构建无卡片、搜索项或可进入路由；中英文、深浅主题、键盘焦点、滚动边界和窄屏样式通过 | 2–3 人日 |
| S2（进行中；S2a–S2f 已完成当前切片） | PostgreSQL 连接、结构和受限分页预览 | 已交付临时 TLS 连接、schema/table 浏览、只读分页预览、最多 20 个不含密码的本地连接资料、请求级预览取消、索引信息，以及多 MiB 文本/JSON/`bytea` 预览截断验证；继续完成其余边界验收，使用本地 Docker PostgreSQL 17+ | 5–7 人日 |
| S3（已完成） | MySQL 与 SQLite 只读适配 | MySQL 8.4+ 和用户选定 SQLite 文件的连接、对象与结构浏览；只读模式、锁等待和断开释放通过本地服务及 Electron 端到端验收 | 4–6 人日 |
| S4（已完成） | 三引擎受限查询与直接编辑 | 三引擎支持单条查询、受限结果和分页、CRUD、跨引擎表数据页、带主键/原值冲突检查的单元格编辑、单表直列查询结果编辑、列管理、当前页导出、服务端筛选排序；PostgreSQL 支持查询取消，连接内提供有界查询历史 | 5–8 人日 |
| S5（已完成当前切片） | 系统监视器首个可用版本 | 本机 CPU/内存、应用进程指标、曲线、周期、暂停恢复、断档和离开清理；Windows 真窗口验收 | 3–4 人日 |
| S6（已完成） | 三引擎批量记录操作 | 多行新增与删除草稿、提交预览和有限事务；保留 S4 单元格编辑与单行冲突保护 | 5–7 人日 |
| S7（进行中；S7a/S7b/S7c 已完成） | 系统监视器完整 MVP | 磁盘、网络、进程列表及字段可用状态；开销、睡眠恢复、PID 重用和 20 次路由切换验证 | 4–6 人日 |
| S8（进行中；S8a/S8b/S8c/S8d 已完成） | 桌面模块发布验收 | Windows、Linux、macOS 打包与实际交互；Web/PWA/Docker 构建隔离检查；三种数据库回归；发布说明、限制和证据齐全 | 3–5 人日 |

完整双模块 MVP 要求同时支持 PostgreSQL、MySQL 和 SQLite，预计 34–51 人日，约 7–11 个全职工作周。这是规划窗口，不是发布日期承诺。S4 后可交付三引擎只读预览版；S5 后可交付双模块预览版。缺少 Linux/macOS 真机证据时，不能把 Windows 验收扩大为三平台已通过。

S8 之后按实际使用反馈排序：

1. 结构查看和安全查询闭环验收后，再规划 DDL 与迁移工具，以及 SQLite 备份和文件权限管理。
2. 数据库运行监控：连接数、活动查询、锁等待、事务和缓存指标；只使用各引擎可用的统计接口，权限不足明确降级。慢查询统计和 SQL 文本隐私单独处理。
3. 远程主机监控：明确 SSH 或受认证 agent 的部署、凭据、授权、版本兼容和升级成本。未接入远程采集器时不展示远程 CPU/内存估计值。
4. 平台化：先以三种受审查的数据库适配器和指标采集器验证内部接口，再决定 SDK 是否稳定。公开插件扩权、商店、告警通知及常驻服务另行立项。

## 验证与证据

### 每片实现时执行

- 使用 `pnpm check` 完成类型检查、lint、单元测试、Web 与 Electron 构建。针对实际修改补充取消、限额、错误脱敏、状态竞争及资源回收测试。
- 用 `pnpm test:e2e <对应测试文件>` 确认 Web 构建中不出现两个工具的卡片、导航和路由；用 `pnpm test:e2e:electron <对应测试文件>` 检查真实桌面桥接和功能流程。新增的测试文件与测试数据按模块归档。
- 数据库集成只使用本地 Docker。PostgreSQL 基线为 17+，后续 MySQL 为 8.4+。测试脚本固定镜像版本并记录实际镜像摘要、随机映射到 `127.0.0.1` 的端口、启动结果和容器/临时卷清理结果。
- 测试数据覆盖 Unicode 标识符、复合主键、无主键、`NULL`、JSON、时间、精确数值、长文本、大字段、视图和并发修改。只读与编辑账号分开，不使用用户真实数据库。
- 连接拒绝、证书错误、权限不足、查询超时、锁等待、取消、大结果、提交中断与服务进程退出均有独立验收。取消后确认服务端查询结束，而非只观察界面停止转圈。
- Docker 不可用时标记数据库集成验收未完成。模拟测试和成功构建不替代集成证据。

### UI 与性能验收

- 先使用 Computer Use 和当前源码新编译的 Electron 应用；只保留一个当前应用实例。验证连接、切表、筛选、查询、编辑冲突、监控暂停恢复及窗口关闭。
- 检查深浅主题、100%/150% 缩放、窄窗口、横向表格滚动、顶部导航、键盘操作和中英文长标签。真实窗口不可用时先执行有限启动与窗口恢复，再记录 headless 覆盖及未验证项。
- 固定测试机、构建、采样周期和测试数据。10 万行、50 列的本地测试表只按页读取，记录分页、取消、可见单元格数量和界面响应；持续滚动不累计全部页面。
- 对候选 WASM 优化使用可复现的代表性输入和相同运行环境，记录 JavaScript 基线、WASM p50/p95 CPU 时间、内存、冷启动与产物大小；未达到量化门槛时保留 JavaScript 实现。
- 默认采样连续运行 30 分钟，并切换路由 20 次。记录服务进程、连接、订阅、监听器、缓存点数、RSS 与 CPU；离开页面后计数归零或回到记录的基线，不能只用一次内存快照证明无泄漏。
- 新依赖不得进入公共应用壳。Web bundle 不含数据库驱动、桌面模块路由或主机采集代码。沿用现有 300 KiB gzip 首屏与 8 MiB 预缓存预算；每个新工具入口静态依赖闭包保留 500 KiB gzip 预算。
- 每片在本文追加源码提交、命令、结果和限制。发布、自动化、真实窗口及性能证据分别记录。计划文档本身不需要启动数据库、采样服务或执行 UI 验收。

## 风险与回滚边界

| 风险 | 实施要求 | 可独立回滚的范围 |
| --- | --- | --- |
| 数据写错或并发覆盖 | 默认只读；编辑显式启用、先预览、事务提交、冲突检查；未知提交结果不自动重试 | 关闭编辑入口并保留只读浏览；已提交的数据变更不由代码回滚撤销 |
| 密码或查询内容泄露 | 凭据单独加密、默认内存态、稳定错误码、禁止敏感日志；测试错误与导出边界 | 禁用持久密码和新增 IPC；保留现有密文文件等待用户处理 |
| 查询或采集拖慢应用 | 独立服务进程、分批读取、有限队列、取消、超时和采样预算 | 关闭对应模块或具体指标；主应用和现有工具继续工作 |
| 跨平台字段差异 | 每字段声明来源、单位、平台和不可用状态；逐平台打包与实际验证 | 只关闭未通过平台的字段或入口，不返回伪造指标 |
| 新布局影响既有工具 | 宽工作区显式启用，不整体修改旧工具布局 | 回退新布局和两条新路由，不修改现有收藏及工具 URL |
| 插件权限扩大 | 两模块使用宿主私有 API；暂不扩展外部插件能力清单 | 移除新增宿主 API，原有插件能力保持可用 |

每片使用一个聚焦的 Conventional Commit，在 `main` 完成规定验证后提交。推送按用户授权执行。数据库写入功能与只读浏览分开提交，采集服务与高成本指标分开提交。回滚以关闭入口或撤销对应提交为主；不删除用户数据库、连接配置或历史构建目录。

## 参考依据

- 用户提供的 Neon Tables 与 Monitoring 截图：用于页面层级、对象树、表格工具栏、时间范围和指标卡片的交互参考。
- [Neon Tables 文档](https://neon.com/docs/guides/tables)：表格浏览、筛选和记录编辑的产品参考；本计划不复制其云平台功能。
- [Neon Monitoring 文档](https://neon.com/docs/introduction/monitoring)：区分数据库指标、活动查询和计算资源监控。
- [Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)：独立 Node 服务进程和消息传递的实现依据；实际能力以项目锁定 Electron 版本的原型结果为准。
- [node-postgres](https://github.com/brianc/node-postgres) 与 [pg-query-stream](https://github.com/brianc/node-postgres/tree/master/packages/pg-query-stream)：PostgreSQL 客户端、查询取消和游标批次读取原型。
- [systeminformation](https://github.com/sebhildebrandt/systeminformation)：桌面系统指标采集依赖。实施前须确认所选稳定主版本、目标平台能力和许可。
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)：操作系统加密存储与 Linux `basic_text` 限制。
- [Node.js os](https://nodejs.org/api/os.html)：CPU 与内存基础信息；实施时以锁定的 Node/Electron 内置 Node API 为准。
- [PostgreSQL 17 事务模式](https://www.postgresql.org/docs/17/sql-set-transaction.html)和[连接与查询超时](https://www.postgresql.org/docs/17/runtime-config-client.html)：数据库端读写模式、执行与锁等待超时的依据。

## 实施记录

2026-10-19：确认两个模块只在 Electron 桌面版提供。Web/PWA/Docker 构建不得显示入口或注册路由。S0 原型已完成本机数据库和 Electron 服务接口验证，完整模块仍待开发。PostgreSQL 使用 `postgres:17-alpine`，image id 为 `sha256:d5daad18926b71c3d663f358af0aea798670cb79fb550c106d19662a9d1627ef`，随机映射端口为 `127.0.0.1:10012`。游标以批量 64 读取 10,000 行。独立取消连接返回 `57014`，取消后原客户端可继续查询。单个 2 MiB `TEXT` 字段仍完整进入 JavaScript；因此自由 SQL 尚未满足硬内存上限门槛。MySQL 使用 `mysql:8.4`，image id 为 `sha256:6e54d72c66fb55fa2bba384cba8c7c0ea9d629fb4d2af613b0eef98d19c6df15`，实际服务版本为 8.4.9，随机映射端口为 `127.0.0.1:12489`。参数化 Unicode 与 JSON 读写通过；对持久 InnoDB 表的只读事务阻止了 INSERT；销毁运行 `SELECT SLEEP(30)` 的连接后，服务端不再显示该查询，且新连接可用。该取消路径通过关闭连接实现，没有确认驱动错误码。SQLite 在 Electron 44.8.0 的 utility process 和 Node 24.22.0 中运行，SQLite 版本为 3.53.4。文件模式的 Unicode 与 BLOB 往返通过；只读连接阻止写入；64 KiB 长度限制阻止 70,000 字节随机 BLOB；持有独占事务时第二连接报告 `database is locked`。三个 Docker 原型容器已删除，SQLite 数据库及 WAL/SHM 文件已清理。Electron `utilityProcess` 消息往返通过；`systeminformation` 5.33.15 在当前 Windows 环境返回 CPU、内存、5 个卷、1 个网络接口和 289 个进程。其他操作系统仍待原生验收。原型未验证 MySQL 与 PostgreSQL 的大字段解码前限额；自由 SQL 继续受单字段硬上限门槛约束。

2026-10-20（S2a，源码提交 `acb21ec`）：交付页面内 PostgreSQL 临时连接、schema/table 发现和结构读取。连接由 utility process 中的 `pg` 执行；默认验证 TLS；密码在提交后立即从输入框清除，不保存连接配置。`pnpm check` 通过，包含 675 项单元测试、类型检查、lint、Web 与 Electron 构建；PWA 首屏 JavaScript gzip 为 299.99 KiB，低于 300 KiB 限制。`pnpm test:e2e:postgres` 通过 1 项 Electron 集成测试，覆盖连接、表结构读取和断开。容器镜像为 `postgres:17-alpine`，image id 为 `sha256:d5daad18926b71c3d663f358af0aea798670cb79fb550c106d19662a9d1627ef`，PostgreSQL 17.10，自动化随机端口为 `127.0.0.1:1385`；容器仅使用本机 trust 认证，启动和销毁均确认。Windows 最新构建真实窗口另以同一版本容器的 `127.0.0.1:4902` 成功连接，测试界面显式选择关闭 TLS，并显示 `public` schema、测试表和两列结构后断开；该容器也已删除。此切片尚未提供分页数据、持久化连接、MySQL、SQLite 或系统指标。

2026-10-20（S2b，源码提交 `8b1b4f4`）：交付 PostgreSQL 只读分页预览和“数据/结构”页签。服务按 SQL 结果限制行数、列数和单元格文本，再传回界面。常见定长主键使用类型化游标和 keyset 分页；无主键或非支持类型使用上限为 1,000,000 行的 offset 分页，并提示并发变更可能造成重复或遗漏。游标、标识符和页偏移在 IPC 与 utility process 边界校验；查询只由应用生成，标识符经过 SQL 引用，参数使用绑定值。`pnpm check` 通过，包含 678 项单元测试、类型检查、lint 和 Web/Electron 构建，Web gzip 首屏预算通过。`pnpm test:e2e:postgres` 通过 2 项直接服务集成测试和 1 项 Electron 端到端测试，覆盖 25 行分页、长文本截断、NULL、主键游标、上一页、无主键偏移分页和断开。容器镜像为 `postgres:17-alpine`，image id 为 `sha256:d5daad18926b71c3d663f358af0aea798670cb79fb550c106d19662a9d1627ef`，PostgreSQL 17.10，端口为 `127.0.0.1:8701`；启动和清理均确认。Windows 最新构建真实窗口显示连接页面；UUID 工具可选 v7，刷新后生成的值仍符合 v7 版本位。此切片没有持久连接、MySQL、SQLite、任意 SQL 或系统指标。

2026-10-20（S2c，源码提交 `499fdc1`）：在 Electron 主进程拥有的应用数据目录加入 PostgreSQL 连接资料存储。用户可以保存、加载和删除最多 20 个资料。资料只包含名称、主机、端口、数据库、用户名和 TLS 模式，不接受或写入密码；选择资料时密码输入框会清空。文件使用版本字段、严格字段检查、64 KiB 上限、串行写入和临时文件原子替换。`pnpm exec vitest run electron/database/postgres-connection-profile-store.test.ts --environment jsdom` 通过 6 项测试，覆盖不写密码、字段验证、并发写入、数量上限、删除和损坏文件。`pnpm test:e2e:electron electron/database-connection-profile.e2e.spec.ts` 通过 1 项 Electron 端到端测试，覆盖保存、重启后加载、密码为空和删除。`pnpm check` 通过，包含 684 项单元测试、类型检查、lint、Web 和 Electron 构建，Web 首屏 gzip 预算通过。Windows 最新构建真实窗口显示了连接资料表单和“密码不会保存”提示；未向用户配置写入测试资料。连接资料 UI 同时清楚标示 PostgreSQL 可用，MySQL 与 SQLite 尚未实现。当前 UUID 工具在同一构建窗口中选择 v7 后生成符合 v7 格式的值；该双端工具继续对 Web 和 Electron 开放。

2026-10-20（S2d，源码提交 `86311aa`）：增加 PostgreSQL 分页预览取消。每个预览有独立请求 ID。主进程校验可信窗口、会话归属和请求 ID，并按会话串行执行普通数据库请求；取消请求可以绕过该队列。utility process 使用短连接执行 `pg_cancel_backend`。服务器确认取消后保留主连接；取消失败或无法确认时关闭主连接并返回 `service-unavailable`。界面显示“取消预览”、区分取消成功和页面先完成，并丢弃过期请求结果。`pnpm test:e2e:postgres` 通过 3 项 PostgreSQL 服务集成测试和 1 项 Electron 端到端测试；覆盖精确请求匹配、服务端查询结束、同一连接后续可用和界面取消。容器为 `postgres:17-alpine`，image id 为 `sha256:d5daad18926b71c3d663f358af0aea798670cb79fb550c106d19662a9d1627ef`，PostgreSQL 17.10，端口 `127.0.0.1:2833`；容器已清理。`pnpm check` 通过，包含 684 项通过、3 项跳过的单元测试、类型检查、lint、Web 和 Electron 构建及 PWA 首屏预算。Windows 最新构建真实窗口连接到 PostgreSQL 17.10，并显示慢预览的取消按钮；自动化端到端测试完成取消后连接复用验证。独立真实窗口手动点击未在 15 秒服务端查询超时前完成，因此手动窗口行为仍以该自动化流程为功能证据。临时预览进程与测试容器已关闭。

2026-10-20（S2e，源码提交 `2230e72`）：结构页增加 PostgreSQL 索引表，显示索引名、主键、唯一性、访问方法、有效状态和定义。查询最多返回每张表 64 条索引；定义文本最多返回 2,048 个字符，并分别提示索引数量或定义文本已截断。定义覆盖主键索引、`INCLUDE` 列、表达式索引和部分索引。索引页中英文案留在桌面工具的懒加载代码中，避免增加 Web 首屏语言包。`pnpm check` 通过，包含 684 项单元测试通过、5 项跳过，类型检查、lint、Web 与 Electron 构建均通过；初始 JavaScript gzip 为 299.98 KiB，低于 300 KiB 限额。`pnpm test:e2e:postgres` 通过 5 项 PostgreSQL 服务集成测试和 1 项 Electron 端到端测试；覆盖索引属性、定义截断和 64 条上限。容器为 `postgres:17-alpine`，image id 为 `sha256:d5daad18926b71c3d663f358af0aea798670cb79fb550c106d19662a9d1627ef`，PostgreSQL 17.10，端口 `127.0.0.1:5906`；容器已清理。UUID v7 服务测试 6 项通过，Chromium 页面测试 1 项通过。Computer Use 重置后仍无法枚举或绑定 Electron 窗口；已启动并关闭唯一的最新预览进程。原生真实窗口手动验收未完成；自动化 Electron 端到端测试通过。

2026-10-20（S2f，源码提交 `2843c10`）：扩展本地 PostgreSQL 测试数据，新增 2 MiB `text`、含 2 MiB 内容的 `jsonb` 和 2 MiB `bytea` 字段。服务集成测试验证每个预览单元格最多返回 256 个字符，并标记内容已截断；序列化的单页结果小于 16 KiB。`pnpm test:e2e:postgres` 通过 6 项 PostgreSQL 服务集成测试和 1 项 Electron 端到端测试。容器为 `postgres:17-alpine`，image id 为 `sha256:d5daad18926b71c3d663f358af0aea798670cb79fb550c106d19662a9d1627ef`，PostgreSQL 17.10，映射端口 `127.0.0.1:12523`；容器启动和清理均确认。`pnpm check` 通过：109 个测试文件通过、1 个跳过；688 项测试通过、6 项跳过；类型检查、lint、Web 和 Electron 构建均通过。PWA 首屏 JavaScript gzip 为 307,186 字节，低于 307,200 字节预算 14 字节。本片只增加集成边界验证，没有新增 UI 改动；自动化 Electron 回归通过，没有单独进行人工真实窗口验收。MySQL、SQLite、其余 PostgreSQL 边界和系统监视指标仍待开发。

2026-10-20（S3）：增加 MySQL 8.4+ 和 SQLite 桌面只读连接。MySQL 页面可浏览 schema、表、视图、列和索引。SQLite 连接只能从主进程原生文件选择器选取文件；utility process 使用 `node:sqlite`，启用 `readOnly`、`query_only`、`trusted_schema=OFF`、扩展禁用和 5 秒锁等待。SQLite 只显示 `main` schema；每个对象的列最多 256 条、索引最多 64 条，索引定义最多 2,048 个字符。没有任意 SQL 或 SQLite 路径 renderer 接口。MySQL 本地 Docker 测试使用 `mysql:8.4`，image id 为 `sha256:6e54d72c66fb55fa2bba384cba8c7c0ea9d629fb4d2af613b0eef98d19c6df15`，实际版本 8.4.9，随机端口 `127.0.0.1:2103`；4 项服务集成测试和 1 项 Electron 端到端测试通过，容器清理已确认。SQLite 本地服务集成测试和 Electron 端到端测试通过；测试用临时文件，完成后清理确认。集成运行时 Node 24.15.0 的 SQLite 版本为 3.51.3，Electron 44.8.0 窗口返回的内置 SQLite 版本为 3.53.4。服务测试覆盖元数据上限、只读拒绝写入、独占锁等待、解锁后恢复及断开后文件可写。Electron UI 测试覆盖系统文件选择取消、打开文件、结构和索引查看、断开。`pnpm check` 通过：110 个测试文件通过、2 个跳过；697 项测试通过、9 项跳过；类型检查、lint、Web/PWA 和 Electron 构建均通过。PWA 首屏 JavaScript gzip 为 307,149 字节，低于 307,200 字节预算 51 字节。当前记录来自自动化集成与 Electron 端到端测试；独立真实窗口验收仍待完成。

2026-10-20（S4 首个查询切片）：三种数据库引擎都提供 SQL 编辑器、`Ctrl+Enter` 执行和分页结果表。编辑器只接受一条只读 `SELECT`，拒绝写入语句、多个语句、绑定参数、危险函数、超过 16 KiB 的输入和超出偏移上限的页码。查询结果最多包含 25 行、16 列和每格 256 个字符；数据库服务先执行受限投影，再将结果传到 renderer。PostgreSQL 使用只读连接设置和 15 秒语句超时，MySQL 使用只读会话及超时，SQLite 使用只读文件连接。查询结果显示页码、行数、运行耗时、截断状态和前后页操作。界面端到端测试验证 SQLite 查询结果首屏显示 25 行，下一页显示第 26 行；三引擎服务测试均验证 26 行结果的分页及大字段上限。没有实现查询历史、取消、筛选、排序、列管理或导出；没有 `ORDER BY` 的 SQL 分页顺序不保证稳定。

验证记录：`pnpm check` 通过，包含 112 个测试文件通过、2 个跳过；706 项测试通过、11 项跳过；类型检查、lint、Web/PWA 和 Electron 构建均通过。PWA 首屏 JavaScript gzip 为 299.95 KiB，低于 300 KiB 限额。`pnpm test:e2e:postgres` 在本机 Docker `postgres:17-alpine` 上通过 7 项服务测试和 1 项 PostgreSQL Electron 端到端测试；实际版本 PostgreSQL 17.10，镜像摘要 `sha256:d5daad18926b71c3d663f358af0aea798670cb79fb550c106d19662a9d1627ef`，映射端口 `127.0.0.1:3228`，容器已清理。`pnpm test:e2e:mysql` 使用 `mysql:8.4`，通过 4 项服务测试和 1 项 MySQL Electron 端到端测试；实际版本 MySQL 8.4.9，镜像摘要 `sha256:6e54d72c66fb55fa2bba384cba8c7c0ea9d629fb4d2af613b0eef98d19c6df15`，映射端口 `127.0.0.1:9882`，容器已清理。`pnpm test:e2e:sqlite` 使用临时本地文件，通过 14 项服务与协议测试和 1 项 SQLite Electron 端到端测试；Node.js 24.15.0、SQLite 3.51.3，临时文件已清理。原 GitHub CI 报错对应的 Math.js Electron 用例通过 1 项。两个修改过的工作流 YAML 均通过解析。Web `dist` 产物没有 MySQL/SQLite 驱动或数据库服务代码；可见的 `database-manager` 文本只在共享语言资源中，不包含页面代码或路由。

Windows 真窗口验收使用重新打包的 x64 Electron 应用，验证时只运行一个 IT Tools 窗口。界面通过原生文件选择器只读打开临时 SQLite 文件，并显示 SQLite 3.53.4。SQL 编辑器运行 `SELECT 1` 后显示 1 行结果；再运行 26 行递归查询，首屏显示 25 行，点击“Next”后显示第 26 行和“Page 2 · 1 row”。完成后断开数据库并删除临时测试文件。数据库编辑、筛选、导出等未实现功能没有纳入本次验收。

2026-10-21（S4 列管理与受限导出切片）：为表数据页和 SQL 结果页增加列显示菜单、当前页范围提示、CSV 和 JSONL 导出。列隐藏只改变 renderer 中已加载的有限结果列，至少保留一列；导出只序列化当前页和当前可见列，不发起额外查询。CSV 对引号、逗号、换行和 `NULL` 做稳定编码，JSONL 按行输出对象；单元测试覆盖这些边界。修复单元格编辑跨 Electron IPC 的结构化克隆问题：保存前将 Vue 响应式主键数组转换为普通对象快照；数据库服务主进程补齐写入错误码校验。SQLite Electron 回归增加列隐藏/恢复、CSV 导出状态和 SQL 结果定位验证。

验证记录：`pnpm check` 通过，包含 114 个测试文件、718 项测试通过、13 项跳过；类型检查、lint、Web/PWA 和 Electron 构建通过，PWA 首屏 JavaScript gzip 为 299.93 KiB。`pnpm exec vitest run src/tools/database-manager/database-export.test.ts --environment jsdom` 通过 3 项导出序列化测试。`pnpm test:e2e:sqlite` 通过 17 项服务与协议测试和 1 项 SQLite Electron 端到端测试；Node.js SQLite 版本为 3.51.3，临时文件清理已确认，Electron 窗口内置 SQLite 版本为 3.53.4。当前切片仍未实现服务端筛选、排序、查询取消和查询历史；本记录使用自动化 Electron 证据，未扩大为独立真实窗口人工验收。

2026-10-22（S4 数据视图与查询控制完成）：三引擎表数据页增加服务端筛选和排序。筛选条件限制为最多 3 个，支持等于、不等于、包含、前缀、后缀及 NULL 判断；排序字段限制为最多 3 个，并追加主键作为稳定排序条件。筛选值使用参数绑定，列名必须匹配已读取的结构元数据。数据页继续保留列显示、当前页 CSV/JSONL 导出和分页条件。PostgreSQL SQL 查询增加请求级取消，取消通过独立连接调用 `pg_cancel_backend`；MySQL 和 SQLite 保留驱动超时边界，界面只显示受支持的 PostgreSQL 取消操作。查询历史只保留在当前连接页面内，最多 20 条，不写入磁盘。

验证记录：`pnpm check` 通过，包含 116 个测试文件通过、2 个跳过；726 项测试通过、16 项跳过；类型检查、lint、Web/PWA 和 Electron 构建通过，PWA 首屏 JavaScript gzip 为 299.93 KiB。`pnpm test:e2e:postgres` 在本机 Docker `postgres:17-alpine` 上通过 10 项服务测试和 1 项 PostgreSQL Electron 端到端测试；实际版本 PostgreSQL 17.10，镜像摘要 `sha256:d5daad18926b71c3d663f358af0aea798670cb79fb550c106d19662a9d1627ef`，映射端口 `127.0.0.1:7142`，容器清理已确认，服务测试覆盖 SQL 查询取消和连接复用。`pnpm test:e2e:mysql` 在本机 Docker `mysql:8.4` 上通过 6 项服务测试和 1 项 MySQL Electron 端到端测试；实际版本 MySQL 8.4.13，镜像摘要 `sha256:76f0358884cb92d9a086d24e5671c38048d3fef40f2588703d73eb55392d6b69`，映射端口 `127.0.0.1:1374`，容器清理已确认。`pnpm test:e2e:sqlite` 通过 19 项服务与协议测试和 1 项 SQLite Electron 端到端测试；Node.js SQLite 版本为 3.51.3，临时文件清理已确认。Electron 自动化回归覆盖筛选、排序、列管理、导出、编辑、查询历史和 PostgreSQL 查询取消；未扩大为独立真实窗口人工验收。
2026-10-24（S5 CPU/内存切片）：系统监视器增加独立 utility process 采样器。采样器读取本机 CPU 累计时间和内存计数器，主进程补充 IT Tools 应用进程的 CPU 与工作集指标。采样周期在 IPC 层限制为 1–60 秒，界面提供 1、2、5 秒选项；历史点数最多保留 3,600 个。页面提供 CPU、内存、应用进程和可用内存指标卡片与有限曲线，支持刷新、暂停、恢复和断档标记。每个 renderer 只允许一个订阅；路由离开、窗口关闭和应用退出都会取消订阅并关闭采样进程。磁盘、网络、进程列表和其他操作系统仍属于 S7 或后续平台验收范围。

验证记录：`pnpm exec vitest run electron/system-monitor/sampler.test.ts electron/system-monitor/worker-protocol.test.ts --environment node` 通过 2 个测试文件、4 项测试；`pnpm typecheck:electron`、`pnpm typecheck:app`、`pnpm lint --max-warnings 0`、`pnpm electron:build` 均通过；`pnpm test:e2e:electron electron/system-monitor.e2e.spec.ts` 通过 2 项 Electron 端到端测试，覆盖指标卡片、曲线、暂停恢复、断档、刷新和停止后的无事件行为。Computer Use 当前无法枚举可绑定的 Electron 原生窗口，因此没有取得独立真实窗口的手动证据；本片只报告自动化 Electron 证据。Windows 以外平台、长时间 30 分钟采样、20 次路由切换和高 DPI 交互仍待 S7/S8 验收。

2026-10-24（S6 批量记录操作）：数据库管理器增加批量新增草稿、表数据行删除标记、草稿预览和一次性事务提交。草稿总数限制为 100 行；提交前由主进程显示原生确认框。新增值按结构列生成，未填写的可编辑列按空字符串提交，NULL 通过单独选项提交；删除草稿携带完整原始行值和主键，服务端在事务中再次核对原值，出现冲突时整批回滚。含 BLOB 等不能安全回读的列仍可新增可编辑字段，但批量删除会停用；取消确认会保留草稿。三种数据库共用受校验的 IPC、utility process 和 renderer 类型。

验证记录：`pnpm exec vitest run electron/database/cell-edit.test.ts electron/database/protocol.test.ts electron/database/sqlite-service.integration.test.ts --environment jsdom` 通过 3 个测试文件、24 项测试；`pnpm test:e2e:sqlite` 使用临时本地 SQLite 文件，通过 20 项服务与协议测试和 1 项 Electron 端到端测试，覆盖读写连接、两行批量新增、预览、事务提交、查询核对和清理，SQLite 3.51.3，临时文件清理已确认。`pnpm test:e2e:postgres` 使用本机 Docker `postgres:17-alpine`，实际 PostgreSQL 17.10，镜像摘要 `sha256:d5daad18926b71c3d663f358af0aea798670cb79fb550c106d19662a9d1627ef`，映射端口 `127.0.0.1:6908`，服务测试和 Electron 端到端测试通过，容器清理已确认。`pnpm test:e2e:mysql` 使用本机 Docker `mysql:8.4`，实际 MySQL 8.4.13，镜像摘要 `sha256:76f0358884cb92d9a086d24e5671c38048d3fef40f2588703d73eb55392d6b69`，映射端口 `127.0.0.1:5788`，服务测试和 Electron 端到端测试通过，容器清理已确认。`pnpm typecheck:electron`、`pnpm typecheck:app` 和 `pnpm lint --max-warnings 0` 通过。Computer Use 当前无法枚举可绑定的 Electron 原生窗口；本片使用自动化 Electron 窗口证据，没有扩大为独立真实窗口人工验收。结构编辑、DDL、导入导出、数据库运行监控以及 S7/S8 的系统监视器范围仍未实现。

2026-10-24（S7a 磁盘与网络切片）：系统监视器 utility process 使用已锁定的 `systeminformation` 5.33.15 每 5 秒采集磁盘容量、已用空间、可用空间、读写速率和网络接口累计字节/速率。每次快照最多返回 64 个文件系统和 64 个网络接口，文本字段限制为 256 个字符；超过上限会标记截断。采样周期仍由主进程统一调度，暂停时不采样但保留 worker，恢复时可以快速发送带断档标记的新基线。界面增加磁盘和网络卡片，并显示受限列表与速率；采集失败、无数据和不支持状态保留空值及状态码。

验证记录：`pnpm exec vitest run electron/system-monitor/sampler.test.ts electron/system-monitor/worker-protocol.test.ts electron/system-monitor/system-info.test.ts --environment jsdom` 通过 3 个测试文件、7 项测试；覆盖容量和速率归一化、非法值、接口/文件系统上限和截断标记。`pnpm typecheck:electron`、`pnpm typecheck:app`、`pnpm lint --max-warnings 0`、`pnpm electron:build` 通过；`pnpm test:e2e:electron electron/system-monitor.e2e.spec.ts` 通过 2 项 Electron 端到端测试，覆盖 CPU、内存、磁盘、网络卡片、暂停恢复断档、刷新和停止后的无事件行为。Computer Use 当前无法枚举可绑定的 Electron 原生窗口；本片使用自动化 Electron 窗口证据。进程列表、睡眠恢复、PID 启动标识和 20 次路由切换仍待 S7b/S8。

2026-10-24（S7b 进程列表切片）：系统监视器每 5 秒读取本机进程列表，只保留 PID、父 PID、名称、状态、启动时间标识、CPU 百分比和内存字段，不传命令行、路径、环境变量、终端或打开文件。进程记录最多 2,000 条，按 CPU 或内存降序排序；界面按名称过滤并每页显示 100 条。进程 key 包含 PID、启动标识和归一化序号，避免仅用 PID 作为跨采样身份。utility process 响应增加结构化字段检查，拒绝超出数组、文本和指标边界的响应。

验证记录：`pnpm exec vitest run electron/system-monitor/sampler.test.ts electron/system-monitor/worker-protocol.test.ts electron/system-monitor/system-info.test.ts --environment jsdom` 通过 3 个测试文件、8 项测试；覆盖进程投影排序、启动标识、字段排除和 2,000 条上限。`pnpm typecheck:electron`、`pnpm typecheck:app`、`pnpm lint --max-warnings 0`、`pnpm electron:build` 通过；`pnpm test:e2e:electron electron/system-monitor.e2e.spec.ts` 通过 2 项 Electron 端到端测试，覆盖进程列表卡片、搜索控件、磁盘/网络卡片、暂停恢复断档、刷新和停止后的无事件行为。Computer Use 当前无法枚举可绑定的 Electron 原生窗口；本片使用自动化 Electron 窗口证据。睡眠恢复、PID 重用现场验证、采样器开销和 20 次路由切换仍待 S7c/S8。

2026-10-24（S7c 断档与路由清理切片）：采样器记录上次单调时间，在时间倒退、计数器重置或超过 120 秒采样间隔时丢弃 CPU 差值，发送新的基线并标记断档；内存和扩展指标继续保留各自状态。系统监视器 Electron 流程增加 20 次“主页 → 系统监视器”切换验证，确认订阅在组件离开后释放，回到主页后不再保留监视器工作区。

验证记录：`pnpm exec vitest run electron/system-monitor/sampler.test.ts electron/system-monitor/worker-protocol.test.ts electron/system-monitor/system-info.test.ts --environment jsdom` 通过 3 个测试文件、9 项测试；新增睡眠间隔后的 CPU 基线重置验证。`pnpm typecheck:electron`、`pnpm typecheck:app`、`pnpm lint --max-warnings 0`、`pnpm electron:build` 通过；`pnpm test:e2e:electron electron/system-monitor.e2e.spec.ts` 通过 3 项 Electron 端到端测试，覆盖磁盘/网络/进程卡片、暂停恢复断档、订阅停止和 20 次路由切换。Computer Use 当前无法枚举可绑定的 Electron 原生窗口；本片使用自动化 Electron 窗口证据。睡眠现场、PID 重用现场、采样器 CPU/内存开销和 Windows/Linux/macOS 原生验收仍待 S8。

2026-10-24（S8a Web 产物隔离门禁）：新增 `scripts/web-platform-isolation.test.mjs`，递归扫描生产 `dist` 的脚本、样式、HTML、JSON 和 source map，拒绝 `systeminformation`、系统监视器/数据库桌面 IPC、MySQL、PostgreSQL 游标和 SQLite 桌面依赖标记进入 Web bundle。测试接入 `pnpm check`，并与既有 Web 端桌面专属路由隐藏和 404 端到端测试配合。

验证记录：`pnpm check` 通过，包含 119 个测试文件通过、2 个跳过；738 项测试通过、18 项跳过；隔离门禁在构建后的 `dist` 上通过，Web 初始 JavaScript gzip 为 299.93 KiB。`pnpm test:e2e src/tools/desktop-platform-visibility.e2e.spec.ts` 的 Chromium 和 WebKit 通过；Firefox 二进制已下载，但本机启动失败并报告 Windows 并行配置错误，因此 Firefox 证据未完成。`docker build --pull=false -t it-tools-template:s8a .` 通过，构建上下文使用 `node:24-alpine` 和 `nginx:stable-alpine`；`pnpm headers:docker` 使用 Docker Server 29.7.2、Nginx 1.30.6 通过 HTTP 头检查，容器已清理。Computer Use 原生窗口证据仍不可用；Windows/Linux/macOS 打包和真实交互仍待后续 S8 切片。

2026-10-24（S8b Windows 打包验收）：使用当前 `main` 运行 `pnpm electron:package:win`。Electron 编译和目录打包阶段可用；NSIS 安装包阶段因外部下载地址 `20.205.243.166:443` 超时而失败。随后使用 `pnpm exec electron-builder --win dir --publish never` 生成 `release/win-unpacked`，作为不依赖安装器下载的 Windows x64 交付目录。新增 `electron/packaged-app.e2e.spec.ts`，按当前平台查找打包可执行文件，使用独立用户目录打开首页、数据库管理器和系统监视器并在结束后清理目录。

验证记录：`pnpm test:e2e:electron electron/packaged-app.e2e.spec.ts` 通过 1 项，打包目录中的两个桌面工作区均可打开；`pnpm typecheck:electron` 和 `pnpm lint --max-warnings 0` 通过。`pnpm perf:baseline -- --runs 1 --platform electron --output docs/performance-baseline-2026-10-24-s8b.json --force` 通过，报告状态为 `exploratory`，源码提交为 S8a 的 `755b599`，启动 1,245.73 ms、空闲 CPU 0.39%、工作集 988,123,136 字节；报告只覆盖 Windows 自动化单轮，不替代 20 轮正式性能基线。Linux/macOS 打包和真实窗口交互没有在本机验证；NSIS 安装包因下载超时未生成。

2026-10-24（S8c 三引擎回归）：重新运行本机数据库回归脚本，验证 S8b 后的数据库管理器和 Electron 构建没有破坏三种引擎的结构与数据流程。PostgreSQL 使用 `postgres:17-alpine`，实际版本 17.10，镜像摘要 `sha256:d5daad18926b71c3d663f358af0aea798670cb79fb550c106d19662a9d1627ef`，映射端口 `127.0.0.1:9130`；MySQL 使用 `mysql:8.4`，实际版本 8.4.13，镜像摘要 `sha256:76f0358884cb92d9a086d24e5671c38048d3fef40f2588703d73eb55392d6b69`，映射端口 `127.0.0.1:5796`；SQLite 使用 Node.js 内置 SQLite 3.51.3 和临时文件。三次脚本均在结束时确认容器或临时目录清理。

验证记录：`pnpm test:e2e:postgres` 的 PostgreSQL 服务测试 11 项通过，Electron PostgreSQL 流程 1 项通过，未匹配的 MySQL 流程 1 项跳过；`pnpm test:e2e:mysql` 的 MySQL 服务测试 7 项通过，Electron MySQL 流程 1 项通过，未匹配的 PostgreSQL 流程 1 项跳过；`pnpm test:e2e:sqlite` 的 SQLite 服务与协议测试 20 项通过，SQLite 结构流程和打包桌面冒烟流程各 1 项通过。Docker 容器和 SQLite 临时目录清理均已确认。三平台打包、NSIS 安装器和真实窗口人工交互仍待对应环境证据。

2026-10-24（S8d Web/Electron 性能基线）：在当前源码和 Windows x64 未压缩包上运行 `pnpm perf:baseline -- --runs 20 --platform all --output docs/performance-baseline-2026-10-24-s8d.json --force`。Web 与 Electron 各完成 20 轮，无失败；每轮使用新浏览器或 Electron 用户目录，包含启动、工具首次/热切换、JSON/正则/数学输入、渲染堆和空闲 CPU/进程组资源样本。

验证记录：报告状态为 `measured`。Web 启动中位数/p95 为 787.30/948.33 ms，空闲 CPU 中位数/p95 为 0.91%/0.97%；Electron 启动中位数/p95 为 907.82/1,067.58 ms，空闲 CPU 中位数/p95 为 0.22%/2.31%。Web/Electron 工作集和交互分位数、20 轮原始样本见[20 轮性能基线](performance-baseline-2026-10-24-s8d.json)。报告只覆盖 Windows 自动化运行，不包含 Linux/macOS 和 Computer Use 原生窗口；系统监视器连续 30 分钟的资源计数仍未完成。
