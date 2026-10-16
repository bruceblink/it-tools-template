# IT Tools 长期开发计划

本计划于 2026-10-16 复核。按阶段的依赖顺序推进，每轮完成一个可独立验收的范围。第一轮执行 [质量基线实施计划](02-quality-baseline.md)。天数表示原始规划窗口，不表示已完成日期。

## 术语与命名约定

| 术语 | English / 缩写 | 本计划中的职责边界 |
| --- | --- | --- |
| 工具定义 | Tool Definition | 描述工具名称、路径、分类、组件、翻译和运行能力的元数据；不代表工具运行时状态。 |
| 应用壳 | Application Shell | 首页、路由、导航、主题、搜索和 PWA 启动所需的公共资源；不包含具体工具的大型依赖。 |
| 本地存储 | Local Storage | 浏览器端持久化设置和非敏感偏好；不用于默认保存凭据或用户秘密。 |
| 运行时缓存 | Runtime Cache | Service Worker 按访问结果缓存资源；不等同于应用首次安装时的预缓存。 |

## 当前基线

项目注册了 117 个工具，提供 9 个语言包。2026-10-15 的本地统一检查已通过：82 个应用测试文件、518 个单元测试、应用和构建配置类型检查、零警告 lint、生产构建。部署响应头一致性和 Node 脚本测试已纳入统一检查。工具注册检查验证了全部工具的英文和中文基础键。质量基线见 [实施记录](02-quality-baseline.md#实施记录)，随机源和 JWT 的最终验收见 [安全任务记录](03-security-inputs-plan.md#实施记录)，内容、HTML 与响应头见 [执行记录](04-security-boundaries.md#执行记录)。按用户的后续要求，`auto-imports.d.ts` 从版本库移除并加入 `.gitignore`；应用类型检查前自动生成该声明。

开发前的主要工程问题与处理状态：

- 应用级 `vue-tsc` 曾有 125 条错误。本轮恢复了标准库配置，修正 `MaybeRef`、第三方类型声明、组件属性和空值处理，已通过检查。
- `pnpm validate` 原来只执行测试和构建。本轮增加 `pnpm check`，并让 `validate` 转发到该入口。
- token、OTP secret、UUID、随机端口和 MAC 已接入默认 Web Crypto 随机源，边界和失败行为有确定性测试。
- JWT 的五个敏感字段及后续 27 个工具的内容输入已改为页面内存状态，并清理固定的旧存储键。显示与处理偏好继续保留。
- PWA 原先首次预缓存约 24 MB；现已按应用壳筛选为 12 个文件、约 1.17 MiB，并为工具资源增加访问后缓存。Monaco、OUI 数据和首屏 JavaScript 的剩余体积目标仍需继续优化，见 [PWA 实施记录](05-pwa-cache-plan.md#执行记录)。
- README 已更新为 117 个工具；需要用注册完整性检查防止工具列表与路由不一致。
- E2E workflow 原来读取了不存在的 Playwright 依赖字段。本轮改为读取实际安装版本、固定浏览器缓存版本，并使用 frozen lockfile。

## 阶段一：质量基线（0-30 天）

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

## 阶段二：安全与数据边界（31-60 天）

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

## 阶段三：性能与 PWA（61-90 天）

已按 [应用壳与离线缓存计划](05-pwa-cache-plan.md) 交付首片：应用壳预缓存、访问后的静态资源缓存、构建报告与 8 MiB 预缓存预算。300 KiB 首屏 JavaScript、500 KiB 可选入口静态依赖闭包的目标继续保留。根据用户明确指示，当前主开发切换至 [Electron Windows 试点](06-web-electron-assessment.md)；剩余 PWA 体积优化保留为后续工作，不影响本次切换。

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

## 阶段四：长期产品与架构（90 天以后）

- 将工具元数据收敛为统一 `ToolDefinition`，增加 `sensitive`、`offline`、`requiresMedia` 和 `supportsShare` 等能力描述。
- 从工具元数据生成路由、菜单、搜索索引、README 工具清单和翻译覆盖报告。
- 先保证所有语言包的键集合一致，再逐步提升翻译质量；命令面板、错误提示和按钮文本全部纳入 i18n。
- 增加工具输入和设置的可分享 URL、收藏夹导入导出、最近使用工具、常用输入模板、批量处理和结果下载。
- 建立键盘导航、焦点恢复、移动端布局、屏幕阅读器标签和颜色对比验收。
- 保持隐私优先、客户端本地运行的产品定位；云端同步、账号和后端服务只有在出现明确需求后再作为可选能力引入。
- 按用户指示启动 [Web 与 Electron 共用界面的评估](06-web-electron-assessment.md) 中的 Windows 试点；完整桌面发布仍需原生权限、Windows 安装升级和工具兼容验收。

## 测试与发布要求

- 每个阶段先通过单元测试、类型检查、lint 和构建，再提交代码。
- UI 变更使用真实浏览器流程验证首页、搜索、收藏、主题切换、移动菜单和关键工具；无法使用真实窗口时，记录 headless 覆盖范围。
- 发布前执行三浏览器 E2E、PWA 离线验证、Docker 镜像构建和安全响应头检查。
- 每个独立功能完成验证后保持独立提交。提交和推送需由用户请求或明确的仓库流程要求；本轮开发不自动发布。

## 默认假设

- 未来 90 天优先级是质量与稳定性。
- 项目继续采用客户端优先、无需后端的默认部署模式。
- 117 个现有工具作为兼容基线，不进行大规模删除或重命名。
- 项目已采用 AGPLv3，Vue 3、Vite、Naive UI、Pinia 和 pnpm 继续作为基础技术栈。
