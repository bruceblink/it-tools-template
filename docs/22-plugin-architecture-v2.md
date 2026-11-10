# 插件系统 v2 设计

> 状态：设计基线
> 更新日期：2026-11-10
> 适用范围：Electron 外部插件、工具注册、命令搜索、扩展宿主和插件权限

## 术语和命名规则

| 中文名称 | English / 标识 | 职责与排除范围 |
| --- | --- | --- |
| 内置扩展 | First-party Extension | 随应用构建、由项目源码审查的扩展；可以使用仓库内 SDK，不代表第三方代码安全。 |
| 外部扩展 | External Extension | 用户安装的签名扩展包；不能直接提供 Vue 组件、HTML、CSS 或主窗口 DOM。 |
| 扩展宿主 | Extension Host | 运行外部扩展代码的独立进程或受限运行时；负责激活、命令执行、取消和清理。 |
| 宿主渲染器 | Host Renderer | IT Tools 的 Vue 渲染器；负责工具页面、表单、结果、导航和命令搜索。 |
| 贡献点 | Contribution Point | 扩展清单声明的工具、命令、设置和数据提供者。它只描述接入位置，不直接授予权限。 |
| 工具工作台 | Plugin Tool Workbench | 宿主提供的声明式工具页面。它使用统一的布局、主题、控件、错误和结果样式。 |
| 能力代理 | Capability Broker | 主进程中的权限检查和执行边界。它只执行已声明、已支持并已批准的能力。 |
| RPC | External Extension RPC | 宿主与扩展宿主之间的版本化 JSON 消息通道；不是任意 Electron IPC 转发。 |
| 受限计算插件 | WASM Plugin | 运行纯计算、解析、转换和校验逻辑的 WASM/WASI 插件；不负责复杂桌面界面。 |

## 1. 设计目标

插件应像 VS Code 和 Zed 的扩展一样接入平台：扩展先通过清单声明身份、贡献点、激活条件和能力；宿主在不执行扩展代码时完成发现、导航和搜索注册；用户真正打开工具或执行命令时，扩展宿主才按需激活。

工具界面由 IT Tools 统一渲染。外部扩展只返回结构化的工具元数据、输入数据、命令结果和状态通知。这样插件工具与内置工具使用同一套 `toolLayout`、主题、键盘操作、响应式布局和错误处理。

扩展代码与主窗口分离。外部扩展不能取得主窗口的 preload、Vue 实例、DOM、Node 文件系统、任意 Shell 或其他插件的数据。所有宿主能力都通过能力代理和版本化 RPC 暴露。

插件系统采用分层运行方式：

1. 内置扩展继续使用当前的第一方 `FirstPartyExtensionHost`，保持最佳性能和完整 UI 能力。
2. 外部扩展优先使用独立扩展宿主和 RPC，适合需要命令、工具和宿主服务的第三方功能。
3. 纯计算逻辑使用 WASM/WASI 运行时，限制文件、网络和进程访问，不承载复杂界面。

## 2. 总体结构

```mermaid
flowchart LR
  Package[Signed Extension Package] --> Registry[Extension Registry]
  Registry --> Metadata[Static Contribution Metadata]
  Metadata --> Shell[Host Renderer]
  Shell --> Nav[Tool Navigation]
  Shell --> Search[Command Search]
  Shell --> Workbench[Plugin Tool Workbench]
  Workbench --> Main[Electron Main Process]
  Main --> RPC[Versioned RPC Channel]
  RPC --> Host[External Extension Host]
  Host --> Code[Extension Code]
  Main --> Broker[Capability Broker]
  Broker --> Services[Approved Host Services]
  Host --> WASM[Optional WASM Runtime]
```

`Registry` 只保存已验证的静态元数据。`Host Renderer` 不加载外部实现代码。`Main Process` 负责扩展宿主进程、RPC 请求和能力代理的边界。箭头表示单向数据或控制流；能力代理的执行结果沿 RPC 返回宿主渲染器。

## 3. 外部扩展清单 v2

外部扩展 v2 使用独立的主版本，避免把 HTML 页面入口与新的扩展宿主协议混在一起。贡献清单只包含可审查的静态数据：

```json
{
  "formatVersion": 2,
  "id": "org.example.json-tools",
  "name": "JSON Tools",
  "version": "1.0.0",
  "apiVersion": { "minInclusive": "2.0.0", "maxExclusive": "3.0.0" },
  "activationEvents": [
    "onTool:org.example.json-tools/summary",
    "onCommand:org.example.json-tools/summarize"
  ],
  "requestedCapabilities": [],
  "contributions": {
    "tools": [{
      "id": "org.example.json-tools/summary",
      "title": "JSON summary",
      "description": "Summarize a JSON document.",
      "keywords": ["json", "summary"],
      "categoryId": "development",
      "dataProcessing": "memory-only",
      "offline": "available",
      "capabilities": [],
      "inputs": [
        { "id": "input", "kind": "text", "multiline": true, "label": "JSON input", "required": true, "maxLength": 16384 }
      ],
      "output": { "kind": "json" }
    }],
    "commands": [{
      "id": "org.example.json-tools/summarize",
      "title": "Summarize JSON",
      "description": "Summarize a JSON document.",
      "keywords": ["json", "summary"],
      "toolId": "org.example.json-tools/summary"
    }]
  }
}
```

宿主校验以下内容后才注册贡献点：插件 ID、版本、API 范围；贡献 ID 是否属于插件命名空间；工具字段类型、数量、长度和结果类型；命令、工具和激活事件是否一一对应；能力是否属于已知目录。工具元数据必须完整存在于签名清单中，不能等扩展代码启动后再改变导航和搜索结构。

运行时入口和签名属于安装包封套，而不是渲染器使用的贡献清单。安装器单独校验 `runtime`、`entrypoint`、文件哈希和 Ed25519 签名，再把通过校验的贡献清单交给本节的静态注册器。这样渲染器不需要信任入口脚本，也不会把安装包路径暴露给工具页面。

## 4. 宿主渲染的工具模型

v2 首先支持有限的声明式工具字段：`text`、`textarea`、`number`、`boolean` 和 `select`。字段包含稳定 ID、标签、说明、占位符、是否必填、默认值和边界值。当前宿主工作台的结果只支持 `text` 和 JSON 值；`table` 结果保留在协议校验层，等宿主完成统一表格渲染后再开放。

宿主使用 `PluginToolWorkbench` 渲染这些字段。组件负责：

- 使用 `toolLayout` 和共享主题值显示标题、说明、输入区、操作按钮和结果区。
- 在提交前执行字段类型、必填项和长度校验。
- 通过 `executeCommand` RPC 发送结构化输入。
- 显示运行中、取消、失败和结果状态。
- 在路由离开、窗口关闭或插件停用时取消未完成请求。

外部扩展不能返回 HTML、CSS、Vue 组件、任意脚本或可执行渲染模板。需要表格、树、日志和文件选择时，先增加宿主审核过的字段和结果类型，再扩展协议。复杂自定义界面不进入 v2 的默认贡献模型。

## 5. 发现、注册和按需激活

生命周期固定为：

```text
discover -> validate -> register -> activate -> ready
                                      |
                         timeout / crash / protocol error
                                      v
                                  disable -> diagnose -> restart
```

1. `discover` 扫描插件安装目录和市场来源记录，不执行插件代码。
2. `validate` 检查签名、版本、资源、贡献点和能力声明。
3. `register` 将静态工具元数据加入统一 `ToolRegistry`，同时更新左侧导航和命令搜索。
4. `activate` 在打开工具或执行命令时启动扩展宿主，并完成 RPC 握手。
5. `ready` 后允许执行已批准的命令和数据提供者。
6. 超时、崩溃、协议错误和资源超限会记录诊断、清理 RPC、撤销能力并标记插件不可用。一个插件失败不能阻塞内置工具或其他插件。

工具路由统一指向宿主 `ToolRoutePage` 和 `PluginToolWorkbench`。插件停用或卸载后，工具导航、收藏和命令搜索都删除对应贡献；旧路由显示明确的不可用状态，不打开残留页面。

## 6. RPC 接口约定

每条消息包含协议版本、请求 ID、插件 ID、方法和 JSON 负载。主进程验证消息大小、字段集合、请求 ID、插件身份和当前会话，然后再转发到扩展宿主。

```json
{
  "protocolVersion": 1,
  "requestId": "req-1",
  "pluginId": "org.example.json-tools",
  "method": "executeCommand",
  "payload": {
    "commandId": "org.example.json-tools/summarize",
    "input": { "input": "{\"ok\":true}" }
  }
}
```

响应只允许成功结果或稳定错误码：`invalid-request`、`unsupported-method`、`not-active`、`permission-denied`、`payload-too-large`、`too-many-requests`、`timeout`、`cancelled`、`transport-error`、`extension-failed` 和 `disposed`。

每个请求都设置超时、取消入口和响应大小上限。宿主限制并发数、自动重启次数和未完成请求数量。`cancel` 只取消目标请求，不改变其他插件会话。关闭或停用时先拒绝新请求，再取消活动请求，最后销毁传输资源。

## 7. 能力、存储和故障边界

能力按用途拆分，例如 `runtime.info`、`clipboard.write`、`settings.read`、`settings.write`、`filesystem.workspace`、`network` 和 `process.spawn`。清单声明、宿主支持和用户批准是三个集合。请求能力不会自动获得批准，工具执行时使用“工具声明能力”与“用户已批准能力”的交集。

插件设置保存在插件专属命名空间。插件只能通过版本化设置 API 读写自己的非秘密值，不能直接读写应用 SQLite、配置文件、凭据或其他插件目录。文件、网络和进程能力必须分别申请，并由能力代理执行入口层校验。

扩展宿主崩溃时，主进程保留工具索引但将工具标记为不可用；用户可以重启或禁用插件。重启达到上限后停止自动重试，保留诊断信息，避免主窗口进入循环故障。

## 8. 兼容策略

现有 v1 HTML/webview 插件保留为 legacy 兼容路径，用于迁移已安装包和读取旧设置。legacy 包不进入 v2 的统一声明式工具注册，除非完成清单转换和显式迁移。新安装默认只接受 v2 包；迁移工具生成新的 v2 清单和签名包，不把旧 HTML 页面伪装成原生工具。

旧版 `ExternalPluginTool.page.vue`、`createPluginEmbeddedWindow` 和 `it-plugin://` 页面服务属于 legacy 运行时。它们不能成为 v2 工具工作台的依赖。v2 的路由、索引、搜索和权限逻辑应与 legacy 适配器分开。

## 9. 分阶段实施和验收

### 阶段一：宿主渲染和静态注册

完成 v2 类型、清单校验、`PluginToolWorkbench`、工具索引适配器和命令搜索静态注册。使用一个声明式 JSON 工具样例验证导航、搜索、路由、窄窗口、主题和键盘操作。

### 阶段二：扩展宿主 RPC

实现独立扩展宿主的握手、激活、命令执行、数据读取、取消、超时和关闭。使用示例插件验证扩展崩溃不会影响主窗口，主进程不会转发未知方法或超出大小的负载。

### 阶段三：权限和设置隔离

接入能力代理、插件专属设置和诊断记录。验证未声明、未支持和未批准能力全部被拒绝；停用、卸载、重启和版本切换清理活动请求与授权。

### 阶段四：WASM 计算插件

为纯计算、解析、转换和校验增加 WASM/WASI 运行时。验证输入输出边界、内存上限、取消、签名、升级、回滚和禁用。

每个阶段都使用独立提交和对应回归。回退只撤销该阶段的 v2 适配器、协议和测试，不删除用户安装数据、设置或 legacy 迁移记录。

## 参考

- [Ramag 插件机制：借鉴 VS Code 与 Zed，构建可扩展的桌面工具平台](https://blog.likanug.top/posts/ramag-plugin-architecture-vscode-zed)
- [VS Code Extension Host](https://code.visualstudio.com/api/advanced-topics/extension-host)
- [VS Code Extension Manifest](https://code.visualstudio.com/api/references/extension-manifest)
- [Zed Developing Extensions](https://zed.dev/docs/extensions/developing-extensions)
- [Zed Extension Capabilities](https://zed.dev/docs/extensions/capabilities)
