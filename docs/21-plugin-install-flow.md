# 插件市场安装流程

本文定义 v2 插件市场、Electron 宿主和 GitHub 仓库之间的安装边界。市场是只读导航，不保存、代理或执行插件包。

## 目标体验

1. 市场查询带有 `it-tools-plugin` topic 的 GitHub 仓库，展示仓库、`plugin.manifest.json` 和发布版本的参考信息。
2. Electron 用户点击“安装最新 Release”后，宿主重新读取仓库元数据，并固定 release asset 和 commit/tag。
3. 主进程通过 HTTPS 下载 `.itxs`，限制大小和重定向，校验 v2 清单、文件哈希、API 兼容范围和签名。
4. 签名者未受信任时，流程停在“需要核对发布者指纹”；信任签名者不会自动批准能力。
5. 安装完成后，v2 包管理器发布安装状态。工具随后进入导航和命令搜索，并使用宿主工作区运行。

## Release 直装

这是默认入口。仓库发布一个 v2 `.itxs` 资产，并在 README 或发布说明中提供签名者公钥指纹。Electron 只下载稳定 Release 资产，复用 v2 包管理器完成校验和暂存。

- 下载在主进程执行，渲染器只传递经过校验的仓库身份。
- 下载完成后先写入随机临时目录；验证失败、安装失败或取消都会清理临时文件。
- 同一时间只允许一个直装任务；页面显示发现、固定、下载、校验和安装进度，并支持取消。
- 安装器拒绝已归档、fork、缺少 `it-tools-plugin` topic、草稿/预发布 Release、多个或超出大小上限的资产，以及已存在的同一插件版本。新版本会在完整校验后切换为活动版本，并保留旧版本供回退。

## 本地开发包

开发者使用 `plugin:create:v2` 生成声明式项目，使用 `plugin:pack:v2` 生成签名 `.itxs` 包。Electron 只接受 v2 清单，不加载 GitHub 原始 HTML 或 JavaScript。

## 状态模型

| 状态 | 含义 | 用户动作 |
| --- | --- | --- |
| `discovering` | 正在读取仓库和 Release 元数据 | 等待或取消 |
| `pinned` | 已固定仓库、版本和 commit/tag | 查看来源摘要 |
| `downloading` | 正在下载临时资产 | 等待或取消 |
| `verifying` | 正在校验包、哈希、API 和签名 | 等待 |
| `installing` | 正在调用 v2 包管理器 | 等待完成 |
| `cancelled` | 用户取消了下载或校验 | 查看提示后重试 |
| `awaiting-trust` | 包有效但签名者尚未受信任 | 核对指纹并添加公钥 |
| `installed` | 包已写入版本目录，尚未运行命令 | 打开工具并运行 |
| `active` | 插件命令正在运行 | 等待命令完成或取消 |
| `failed` | 下载、校验或安装失败 | 按错误码重试 |

每个失败结果保留稳定错误码和下一步动作。网络错误不会让半成品目录出现在已安装列表中；签名错误不会降级为其他包格式。

## 仓库发布约定

市场发现至少需要：

- `it-tools-plugin` topic；
- `plugin.manifest.json`，用于展示 v2 API 范围、能力和工具贡献；
- 清楚的 README，说明发布者、公钥指纹、安装方式和能力用途。

推荐发布 `.itxs` Release asset，并在 Release 说明中列出包版本、SHA-256 和签名者指纹。包内签名仍是安装校验的唯一依据。

## 当前交付状态

1. 市场只读 GitHub 目录、Electron v2 包安装、信任、能力批准和命令生命周期管理已经接通。
2. `electron/plugin-marketplace-installer.ts` 和 `desktop:plugins:install-from-marketplace` IPC 负责重新校验仓库、固定 tag/commit、限制下载、流式校验、进度/取消、清理临时文件，并复用 v2 包管理器。
3. v2 工具由宿主统一渲染，支持导航、搜索、设置、运行、取消、超时、失败诊断、重试和卸载。
