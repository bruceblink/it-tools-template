# 插件市场目录

插件市场是一个只读目录，不存储、代理或分发插件包。插件仍由各自的 GitHub 仓库维护，用户从市场查看公开信息后跳转到仓库，或在 Electron 中请求安装仓库发布的已签名 Release。直装下载由 Electron 主进程临时完成，完成校验后删除下载文件；市场本身不托管插件包。

## 发现规则

默认使用 GitHub REST API 的仓库搜索接口，查询带有 it-tools-plugin topic 且未归档、非 fork 的公开仓库：

~~~text
topic:it-tools-plugin archived:false fork:false
~~~

插件仓库要出现在目录中，至少需要：

- 添加 it-tools-plugin GitHub topic；
- 提供仓库描述和 README；
- 推荐提交 plugin.source.json，市场会在详情窗口读取它的 API 版本、能力声明和工具贡献元数据；
- 不要把私钥、凭据或未经审查的发布资产提交到仓库。

市场读取 GitHub 的仓库元数据和 plugin.source.json 摘要，不执行仓库代码，不在 Web 页面下载 .itxs 文件，也不把结果写入应用后端。Electron 直装会重新读取仓库和 Release 元数据，并在主进程复用本地安装器完成签名、哈希和资源限制校验。桌面详情还提供“从固定提交构建”入口；该入口只传递仓库身份，commit 和签名密钥仍由用户在设置页核对或选择。

## 配置

默认配置适用于公开 GitHub 目录：

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| VITE_PLUGIN_MARKETPLACE_API_BASE | https://api.github.com | GitHub API 或兼容的只读 API 基地址，必须是 HTTPS |
| VITE_PLUGIN_MARKETPLACE_TOPIC | it-tools-plugin | 插件仓库注册 topic |
| VITE_PLUGIN_MARKETPLACE_OWNER | 未设置 | 可选的 GitHub 用户过滤条件 |

浏览器直接调用 GitHub API 使用匿名额度；达到速率限制时，页面会提示稍后重试。若后续需要更高额度，应增加不保存插件包的只读代理或缓存层，并单独审查凭据、缓存和隐私边界。
如果把 API 基地址改成其他 HTTPS 代理，还要把该域名加入 `security-headers.json` 的 `connect-src`，再运行 `pnpm headers:sync`；页面不会绕过 CSP 自动连接未声明的域名。

## 页面行为

- /plugin-marketplace 提供搜索、排序、分页、仓库卡片和详情窗口；
- 卡片只显示仓库公开元数据；
- 详情窗口可读取 plugin.source.json，但明确标记为参考信息；
- “打开仓库”和 README 链接均在新窗口打开；
- Web 和 Electron 共用目录页面；Electron 卡片提供“安装最新 Release”，Web 页面只提供导航和参考信息；自定义 API 代理不会显示固定 GitHub 直装按钮；
- Electron 页面显示发现、下载、校验和安装进度，支持取消和重试；直装失败时显示稳定错误类型，用户可回到插件设置核对签名者或改用仓库说明中的开发者构建流程。

## 桌面直装约定

直装按钮只接受符合以下条件的仓库和 Release：

- 仓库仍是公开、未归档、非 fork，并保留 `it-tools-plugin` topic；
- 最新稳定 Release 恰好包含一个 `.itxs` 资产，资产大小不超过宿主包上限，下载地址属于 GitHub Release 路径；
- 主进程重新读取 Release tag 对应的 commit SHA，限制重定向到 GitHub 下载域名，并在写入临时目录后流式核对实际大小和 SHA-256；
- 下载资产随后交给现有生命周期安装器；安装来源写入 `.plugin-provenance.json` 作为可丢失的诊断元数据，签名者未受信任、版本重复或包清单无效时不会自动放宽规则。

市场不把源码直载作为安装回退。需要审查或开发时，使用固定 commit 的源码快照和 `plugin:build` 完成显式本地构建，边界见[插件市场安装流程](21-plugin-install-flow.md)。
