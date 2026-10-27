# 内容输入、HTML 输出与部署响应头

日期：2026-10-15。从当前 `main` 继续。长期目标和执行顺序仍以 [开发计划](../01-development-plan.md) 为准；本文件承接第二阶段未完成的安全工作，不替代后续性能、PWA、架构和产品任务。

## 术语与范围

- 内容输入（Content Input）：用户粘贴或编辑的凭据、token、请求、配置、代码、文档及网络数据。内容可能包含秘密；默认不自动写入浏览器存储或 URL。
- 工具偏好（Tool Preference）：算法、格式、单位、开关和数量等显示或处理选项。保留现有非敏感偏好；本轮不增加“记住此设备”功能。
- HTML 渲染边界（HTML Rendering Boundary）：将用户内容作为网页 DOM、预览或打印内容显示的位置。复制和下载的原始转换结果不等同于在应用中执行该结果。
- 内容安全策略（Content Security Policy / CSP）：浏览器按 HTTP 响应头约束资源加载和脚本执行。策略必须保留已验证的工具、字体、worker、文件预览和 PWA 行为。

## 工作顺序与验收条件

1. 检查全部现有内容持久化路径。将自动保存的内容改为页面内存，按固定键清理旧内容，不读取或记录旧值，不清空无关设置。安全相关工具显示保存范围；存储异常不得中断当前页面处理。现有明确输入的 URL 可以作为一次性输入读取，但后续编辑不得自动加入 URL。
2. 统一 DOMPurify 的 HTML 渲染入口。检查共享 Markdown、转换预览、打印、新窗口、Base64 图片、SVG 和下载路径。恶意元素、事件属性、危险 URL 和 opener 访问不得越过渲染边界；正常格式、复制与下载继续可用。下载保持用户明确请求的原始内容，不声称下载文件已完成安全检查。
3. 为 Nginx、Vercel、Netlify 配置一致的 CSP、`X-Content-Type-Options`、`Referrer-Policy` 和 frame 防护。增加配置一致性检查，验证页面、路由回退、静态文件和错误响应的实际边界。先消除与策略冲突的应用行为；不得仅为使测试通过而放宽脚本执行来源。
4. 增加行为回归：不持久化敏感内容、固定键清理、路由与刷新重置、存储失败、恶意 Markdown/HTML/SVG、打印或预览隔离、资源加载及响应头。

## 验证方式

```sh
pnpm check
pnpm test:e2e
git diff --check
```

先执行受影响的单元与浏览器测试，再对最终源码执行统一检查和三浏览器生产构建验收。真实窗口先使用 Computer Use；无法完成时记录具体限制和启动、恢复结果，再使用 headless 测试。

Nginx 响应检查使用本地 Docker。记录镜像版本、端口、启动结果和清理结果。Vercel/Netlify 本轮检查配置和本地浏览器行为，不自动部署；线上响应只有实际部署后取样才算已验证。外部数据库集成：不适用。

## 部署配置与兼容范围

`security-headers.json` 是三个部署配置的共同来源。`pnpm headers:sync` 生成配置；`pnpm headers:check` 检查文件一致性，并通过 Node 测试运行器执行脚本测试。Vitest 仅收集应用测试。统一 `pnpm check` 必须包含这两类测试。

脚本只允许同源加载，不允许 `unsafe-eval` 或内联脚本。Naive UI 会动态插入样式，现有组件也使用 style 属性，因此 `style-src` 保留 `unsafe-inline`。图片允许同源、data URI 和 HTTPS；Monaco 与 RSA 的 worker 允许同源或 blob；相机录像允许同源或 blob 媒体。字体文件保持同源；Figlet 字体请求仅允许 `https://unpkg.com`。

默认关闭 Plausible 统计，不额外放行统计域名。使用自定义 API 时，必须把同一个无路径 HTTPS origin 写入 `plausibleApiOrigin` 和构建环境的 `VITE_PLAUSIBLE_API_HOST`，再运行同步与检查。脚本会拒绝不匹配的配置，不开放通用 HTTPS 连接权限。

Nginx 使用 `always`，以覆盖错误响应。Vercel 使用 `headers` 和 SPA `rewrites`，避免与旧 `routes` 配置冲突。Netlify 保留已有的 SPA 回退规则。配置一致性不等于平台线上响应验收。

Docker 检查器只清理本次生成的唯一容器。收到 `SIGINT` 或 `SIGTERM` 后，检查器等待当前有超时限制的操作结束，再执行清理，并保留 130 或 143 退出码。读取日志失败不得跳过清理；Docker daemon 不可达不能视为容器已删除。强制结束 Node 进程、断电或操作系统无法终止 Docker CLI 时，无法保证清理。脚本单元测试使用模拟 CLI；实际容器与响应仍需单独验证。

`iarna-toml-esm@3.0.5` 原先在模块初始化时通过 `eval` 查找 Node 的自定义调试 Symbol，即使异常被捕获也会触发 CSP。版本补丁改为 `Symbol.for('nodejs.util.inspect.custom')`，不改变 TOML 解析状态机。该共享 Symbol 可在浏览器中忽略，并保持 Node 调试行为，见 [Node 官方说明](https://nodejs.org/download/release/latest-jod/docs/api/util.html#utilinspectcustom)。补丁路径和哈希写入 pnpm 配置与锁文件；干净安装必须使用 frozen lockfile 验证。

首页使用的 `vuedraggable@4.1.0` UMD 包含旧的 `Function("return this")` 全局对象探测。由于首页随路由初始化加载，这条探测会影响所有工具。版本补丁将包的已有 `module` 入口指向随包发布的 `src/vuedraggable.js`，让 Vite 使用原始 ESM 组件；不修改压缩文件，不改变 Node 的 `main` 入口。收藏列表的渲染、添加和移除需要在严格 CSP 下重新验收。

Monaco 的独立编辑器没有默认 Worker 入口，原先在主线程回退计算。文本差异组件现在通过 Vite 的 `?worker` 入口启动同源编辑器 Worker，仅接受该组件需要的 `editorWorkerService`。组件负责创建和释放两个文本模型；页面卸载时先释放编辑器，再释放模型，使 Monaco 可以停止无模型可处理的 Worker。浏览器回归同时检查编辑结果、Worker 回复及回退警告。

ASCII 字体路径使用明确的 `https://unpkg.com`，避免 `//unpkg.com` 在本地 HTTP 部署下继承 HTTP、被 CSP 阻断。字体回归使用本地真实字体文件作为网络回包，不访问第三方服务；它验证加载地址、浏览器策略和渲染行为，不证明外网字体服务可用。

## 提交与回滚边界

沿用用户已授权的测试后提交、推送流程。内容隐私、HTML 边界和部署响应头分别形成可审查提交。仅回退对应源文件、配置、测试和文档，不重置工作区。旧敏感键的删除不备份、不记录，代码回退不能恢复已删除的旧值。

## 执行记录

开始时已核对：`main` 与远端均为 `cf367fa`，工作区干净，本机 Docker 可用。初始检查发现凭据解析、请求/配置、文档与网络数据仍使用 `useStorage`，Markdown 打印直接写入新窗口；三个部署入口尚未配置本轮要求的安全响应头。

本轮实现将 27 个工具的内容改为 `ref`，保留各自的非敏感偏好，并按当前工具删除 35 个固定旧键。正则表达式仅在组件创建时读取单个字符串 query，后续编辑不写 URL。共享提示说明内存保存范围；清理失败时显示提示并继续当前处理。HTML 净化入口统一用于共享 Markdown 与打印 DOM，SVG 文本按 XML 转义，原始 HTML/Base64 下载仍保留用户明确请求的字节。

输入隐私批次已完成三浏览器专项验收，21 项全部通过。`745621f security: keep tool content in memory` 已推送 `main`，对应 [CI](https://github.com/bruceblink/it-tools-template/actions/runs/38736090470) 通过。其他批次的验收与提交结果分别记录如下。

HTML/SVG 批次的三浏览器专项验收 15 项全部通过，覆盖共享 Markdown 链接、打印窗口隔离、SVG 文本转义下载、Base64 图片边界与原始 HTML 文件字节。Firefox 的打印窗口使用空 URL，避免显式 `about:blank` 导航覆盖已写入内容。`6ceab10 security: sanitize rendered html and svg output` 已推送 `main`，对应 [CI](https://github.com/bruceblink/it-tools-template/actions/runs/38737701148) 通过。

两项依赖补丁的 `pnpm install --frozen-lockfile --ignore-scripts` 已通过。最终源码的完整 `pnpm check` 已通过：11 个 Node 脚本测试、82 个应用测试文件与 518 个单元测试、两类 TypeScript 检查、零警告 ESLint 和生产构建。构建仍报告 `mime-types` 的 `path`、`pdf-signature-reader` 的 `tls` 浏览器外部化提示、`js-sha256` 仅 Node 分支的 eval 提示和大 chunk 提示；本轮没有隐藏这些提示。PWA 仍全量预缓存约 22.8 MiB，后续按 [PWA 计划](05-pwa-cache-plan.md) 处理。

最终三浏览器 headless 回归 273/273 通过，0 失败、0 跳过、0 flaky，包含 27 项 CSP 兼容检查。字体专项的三个浏览器也分别通过精确输出检查。最终运行使用 `--workers=1`，与 CI 配置一致；本机并行运行曾出现 Firefox `browserContext.close` 协议错误，未把该次失败计为通过，也未增加重试来隐藏它。

本地响应验收使用 Docker Server 29.7.2 与 Nginx 1.30.6，镜像 `nginx:stable-alpine`，digest `sha256:ed84151ed2d47ef93c0939eb9b9754c6990db6092cd2081e11988a47a83d47ea`。端口为 `127.0.0.1:18080 -> 80`。最终 `pnpm headers:docker` 通过：`nginx -t` 成功；首页、SPA 路由、JS、CSS、Service Worker、manifest 的 200 响应及 POST 的 405 错误响应均包含一致的四项安全响应头。浏览器验收容器和脚本创建的容器均已删除，18080 无监听且可重新绑定。

真实窗口验收未完成。Computer Use 已启动 Chrome 并刷新窗口列表，但在读取浏览器状态时因无法可靠识别 URL 而停止本轮操作。未继续发送 UI 输入；上述结果是 headless 与本地 Docker 证据。Vercel/Netlify 未部署，线上响应尚未取样；外部数据库集成不适用。
