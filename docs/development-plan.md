# IT Tools 长期开发计划

## 术语与命名约定

| 术语 | English / 缩写 | 本计划中的职责边界 |
| --- | --- | --- |
| 工具定义 | Tool Definition | 描述工具名称、路径、分类、组件、翻译和运行能力的元数据；不代表工具运行时状态。 |
| 应用壳 | Application Shell | 首页、路由、导航、主题、搜索和 PWA 启动所需的公共资源；不包含具体工具的大型依赖。 |
| 本地存储 | Local Storage | 浏览器端持久化设置和非敏感偏好；不用于默认保存凭据或用户秘密。 |
| 运行时缓存 | Runtime Cache | Service Worker 按访问结果缓存资源；不等同于应用首次安装时的预缓存。 |

## 当前基线

项目已有 117 个工具、9 个语言包、461 个单元测试和可完成的生产构建。当前工作区仍有一项用户已有的 `auto-imports.d.ts` 未提交修改，本计划不覆盖它。

主要工程问题：

- 应用级 `vue-tsc` 尚未通过。`tsconfig.vitest.json` 覆盖了应用标准库配置，多个文件从 `@vueuse/core` 引入未导出的 `MaybeRef`，并存在第三方包声明、组件属性和严格空值检查错误。
- `pnpm validate` 只执行单元测试和构建，未包含应用类型检查和 lint。
- token、OTP secret 以及部分 UUID 参数仍依赖 `Math.random()`。
- JWT secret、payload 等敏感内容默认写入浏览器 `localStorage`。
- PWA 构建产物约 24 MB，Monaco、OUI 数据和语言资源产生多个超大 chunk。
- README 仍声明 86 个工具，与实际注册数量不一致。
- E2E workflow 的 Playwright 版本读取路径不正确，且安装步骤未使用 frozen lockfile。

## 阶段一：质量基线（0-30 天）

### 工作内容

- 修复 `vue-tsc`：恢复 `ES2022 + DOM` 类型库，统一从 `vue` 引入 `MaybeRef`，修正 Fuse、figlet、第三方包声明和组件 prop 类型。
- 新增统一 `pnpm check`，依次运行 `typecheck`、`typecheck:app`、`lint --max-warnings 0`、单元测试和生产构建。
- 让 CI、Docker nightly 和 release workflow 使用统一检查。
- 修正 Playwright 版本读取、锁文件安装和浏览器缓存键。
- 增加工具注册完整性检查，验证路径、名称、分类、组件和翻译键。
- 更新 README、CHANGELOG 和贡献指南，移除过时的 `dev` 分支要求。

### 验收条件

- 应用类型检查无错误，lint 无 warning。
- 461 个现有单元测试持续通过。
- CI 中 Chromium、Firefox 和 WebKit 的 E2E 测试通过。
- 生产构建无未解释的配置错误或依赖解析警告。

## 阶段二：安全与数据边界（31-60 天）

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

## 测试与发布要求

- 每个阶段先通过单元测试、类型检查、lint 和构建，再提交代码。
- UI 变更使用真实浏览器流程验证首页、搜索、收藏、主题切换、移动菜单和关键工具；无法使用真实窗口时，记录 headless 覆盖范围。
- 发布前执行三浏览器 E2E、PWA 离线验证、Docker 镜像构建和安全响应头检查。
- 每个独立功能保持独立提交，验证通过后立即推送 `main`。

## 默认假设

- 未来 90 天优先级是质量与稳定性。
- 项目继续采用客户端优先、无需后端的默认部署模式。
- 117 个现有工具作为兼容基线，不进行大规模删除或重命名。
- GPLv3 迁移为 AGPLv3，Vue 3、Vite、Naive UI、Pinia 和 pnpm 继续作为基础技术栈。
