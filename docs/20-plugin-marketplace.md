# 插件市场目录

插件市场是一个只读目录，不存储、代理或分发插件包。插件仍由各自的 GitHub 仓库维护，用户从市场查看公开信息后跳转到仓库，再按仓库说明完成审查、签名和安装。

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

市场读取 GitHub 的仓库元数据和 plugin.source.json 摘要，不执行仓库代码，不下载 .itplugin 文件，也不把结果写入应用后端。

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
- Web 和 Electron 共用目录页面；插件安装仍只在 Electron 管理器中完成。
