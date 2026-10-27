# Electron 插件开发 API v1

本文定义 Electron 插件渲染器使用的稳定 JavaScript API v1。它只适用于 Electron 插件窗口。Web 插件和内置工具不能使用此接口。插件包 `formatVersion` 负责 ZIP 和签名格式；清单的 `apiVersion` 负责宿主 API 兼容范围；`window.itTools.apiVersion` 负责渲染器 JavaScript API 版本。这三项版本互不替代。

宿主在插件代码运行前注入 `window.itTools`。插件不需要创建 preload，也不能访问 Node.js、宿主 IPC、插件文件系统或其他插件的数据。

TypeScript 插件可以引用 [`plugins/sdk/it-tools-plugin.d.ts`](../plugins/sdk/it-tools-plugin.d.ts) 获得运行时 API 类型，并引用 [`plugins/sdk/it-tools-plugin-package.d.ts`](../plugins/sdk/it-tools-plugin-package.d.ts) 获得 `plugin.source.json` 清单和工具贡献类型。JavaScript 插件可直接使用相同的接口。

```ts
const runtime = await window.itTools.capabilities.runtime.getInfo();
document.querySelector('#platform')!.textContent = runtime.platform;

try {
  await window.itTools.capabilities.clipboard.writeText('Copied by the host');
}
catch (error) {
  if (error instanceof window.itTools.PluginApiError && error.code === 'permission-denied') {
    // Show that the user has not granted clipboard access.
  }
}
```

`window.itTools.apiVersion` 当前为 `1.2.0`。`window.itTools.hostApiVersion` 当前为 `1.3.0`。插件清单的 `apiVersion` 范围必须包含宿主 API 版本。运行时 API 包含 `toolId`（宿主选择的工具贡献 ID）、`runtime.getInfo()`、`clipboard.writeText(text)` 和持久设置方法。`toolId` 只描述启动上下文，不是能力授权，也不能用于绕过宿主校验。清单没有请求能力或用户没有授权时，宿主会拒绝调用。

桌面管理器的 `listPlugins()` 快照同时返回 `requestedCapabilities`、`supportedCapabilities` 和 `grantedCapabilities`。前者是包声明，中者是当前宿主可以执行的能力，后者是本次运行实际授予的能力。渲染器应使用快照中的 `supportedCapabilities` 决定是否显示授权控件，不应复制宿主能力列表。已知但暂未实现的清单声明仍会保留在 `requestedCapabilities` 中，并显示为不支持。

`PluginApiError` 提供稳定的 `code` 和 HTTP `status`。本地参数错误和传输失败使用状态 `0`。宿主错误只返回错误代码，不包含执行器异常文本。插件可以按错误代码显示用户可理解的状态，不需要依赖宿主内部错误消息。

| 错误代码 | 含义 |
| --- | --- |
| `permission-denied` | 用户没有批准该能力。 |
| `capability-not-requested` | 插件清单没有请求该能力。 |
| `plugin-inactive` | 插件窗口已停用或已关闭。 |
| `invalid-input` | 客户端拒绝了不符合接口限制的输入。 |
| `rate-limit-exceeded` / `too-many-requests` | 调用频率或并发数超过限制。 |
| `transport-error` / `invalid-response` | API 请求失败，或宿主响应格式无效。 |
| `capability-failed` / `response-too-large` | 宿主操作失败，或返回内容超过限制。 |
| `not-found` / `method-not-allowed` / `untrusted-initiator` / `untrusted-origin-header` | 宿主拒绝了错误路径、方法或来源。 |

## 请求格式

插件渲染器向同源路径 `POST /__it_tools/v1/call` 发送 JSON：

```json
{
  "id": "request-1",
  "capability": "runtime.info",
  "operation": "read",
  "input": {}
}
```

该路径的 `GET` 查询形式由宿主内部保留，用于加载 Worker guard 和 `window.itTools` 客户端。它不执行能力调用，也不是插件 API。插件作者应使用 `window.itTools`，不应直接调用此传输路径。插件请求通过上述 `POST` 协议进入宿主代理。

请求必须使用 `application/json`。消息只接受 `id`、`capability`、`operation` 和 `input` 四个顶层字段。请求 ID 最长 64 个 ASCII 字符。未知字段、错误操作或不符合能力参数结构的请求会被拒绝。

当前协议支持：

| 能力 | 操作 | 输入 | 结果边界 |
| --- | --- | --- | --- |
| `runtime.info` | `read` | 空对象 | 返回宿主执行器提供的 JSON 数据 |
| `clipboard.write` | `writeText` | `{ "text": "..." }` | 文本最多 16 Ki 个字符；宿主执行器决定是否执行 |
| `settings.read` | `get` | `{ "key": "..." }` | 读取当前插件命名空间中的一个非秘密设置 |
| `settings.write` | `set` / `delete` | `{ "key": "...", "value": ... }` 或 `{ "key": "..." }` | 写入或删除一个非秘密设置 |

这些 ID 仅是协议标识。宿主必须为每个已加载插件提供独立执行器。清单声明的请求能力不会自动获得授权。

## 来源检查与资源限制

Electron Session 只接受插件自身主框架对其 `it-plugin://<pluginId>` 来源的 API 请求。宿主检查来源、主框架、活动窗口 ID 和请求类型。`Origin` 请求头必须匹配插件来源或为浏览器生成的 `null` 值。沙箱禁止外部 HTTP、HTTPS、WebSocket 和 FTP 请求。

代理对每个请求执行固定输入校验，并限制以下资源：

- 请求体最多 16 KiB，响应最多 16 KiB。
- 每分钟最多 30 次调用。
- 同时最多执行 4 次调用。
- 窗口关闭时撤销授权。已开始但尚未完成的调用不会把结果返回给已停用插件。

代理不会把执行器异常文本返回给插件。调用失败只返回通用错误代码。响应禁止缓存，并附带 `X-Content-Type-Options: nosniff`。

## 响应与错误

成功响应格式如下：

```json
{
  "id": "request-1",
  "ok": true,
  "result": { "platform": "win32", "version": "2026.10.18" }
}
```

失败响应包含 `ok: false` 和稳定错误代码。常见 HTTP 状态为 400（请求无效）、403（来源或授权拒绝）、405（方法不支持）、413（请求过大）、415（内容类型错误）、429（调用频率或并发超限）、410（插件已停用）和 500（执行失败或响应过大）。

## 当前实现与限制

`window.itTools.apiVersion` 当前为 `1.2.0`，`window.itTools.hostApiVersion` 当前为 `1.3.0`。新增的 `toolId` 是宿主在贡献页面启动时写入的只读上下文；整包启动时为 `undefined`。`settings.get(key)`、`settings.set(key, value)` 和 `settings.delete(key)` 只保存字符串、有限数字、布尔值或 `null`。设置键最多 64 个字符，字符串值最多 4 Ki 个字符，每个插件最多保存 128 个值。设置按插件 ID 命名空间保存到宿主用户数据目录，跨插件、插件版本和应用重启隔离。设置不是凭据存储，也不提供文件、网络或秘密管理能力。

签名样例会读取宿主返回的运行时信息、读写持久设置，并在授权后通过客户端写入剪贴板；自动化 E2E 会替换操作系统剪贴板执行器，不写入真实剪贴板。插件未获授权时，客户端返回 `PluginApiError`，错误代码为 `permission-denied`。能力请求仍需由用户在桌面管理界面单独批准。Web 端没有对应的系统能力代理。

调用次数限制只约束每个插件的一次沙箱会话；目前不提供跨启动的调用配额、用户可配置的频率策略、通用文件访问或通用网络代理。设置存储使用版本 1 的宿主 JSON 文件，并以临时文件和重命名方式更新；宿主拒绝损坏、符号链接、硬链接和超出大小限制的文件。签名清单现在支持可选的 `contributions.tools` 显示元数据，宿主为已安装版本生成 `/extensions/<plugin-id>/<version>/<tool-id>` 元数据页面。页面的运行和停止按钮只调用现有宿主生命周期接口；快照中的 `activeContributionId` 标识当前隔离窗口选择的工具。窗口意外关闭、渲染进程崩溃和持续无响应会返回稳定故障代码，成功再次运行会清除当前会话的故障记录；设置页和工具页面通过受信的 `desktop:plugins:changed` 事件刷新状态。能力确认和隔离窗口边界保持不变。页面不执行插件代码，也不把外部实现注册到宿主工具路由。插件包仍处于实验阶段，不代表第三方插件可公开分发，也不替代操作系统进程隔离。Linux 和 macOS 运行时验收仍待完成。

工具贡献元数据还可以声明 `dataProcessing`、`offline` 和工具级 `capabilities`。宿主校验工具能力必须属于插件清单的 `requestedCapabilities`；从工具页运行贡献时，只向该隔离窗口授予当前工具声明的能力。设置页运行整包时，仍按用户选择的整包授权执行。未声明这些可选字段的旧签名包使用 `unspecified`、`unknown` 和空能力列表，原签名载荷保持兼容。

清单能力 ID 的集合大于当前 v1 执行器支持的集合。宿主会保留并展示已知但暂未实现的声明，启动沙箱时只把当前支持的能力交给代理；未实现的能力不会获得授权，也不会阻止包在没有这些能力的情况下运行。插件应根据实际 API 支持情况处理 `permission-denied` 或 `capability-not-requested` 错误。

## 验证

`electron/plugin-api-v1.test.ts` 检查 API 版本、运行时查询、授权错误、设置键和值限制、本地输入限制和响应结构。`electron/plugin-capability-broker.test.ts` 检查来源、请求结构、四类能力授权、响应边界、大小限制、频率、并发和撤销。`electron/plugin-settings-store.test.ts` 检查插件命名空间、并发写入、持久化、删除、损坏文件和资源限制。`electron/plugin-manager.e2e.spec.ts` 验证签名样例使用 `window.itTools`，并通过授权前后的运行时查询、剪贴板写入和跨版本设置读取。关闭沙箱窗口时，宿主在销毁前保存 `webContents.id`，以避免关闭事件读取已销毁对象。
