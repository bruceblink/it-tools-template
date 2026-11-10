# WASM 整数加倍示例

本示例展示一个独立的 C 插件如何用 Zig 编译为 WASM，并通过 IT Tools v2 的纯计算 ABI 运行。示例只处理输入整数，不申请文件、网络或其他宿主能力。

## 文件

- `plugin.manifest.json`：v2 静态插件清单，描述工具、命令、输入项和结果类型。
- `src/extension.c`：插件实现。它接收 UTF-8 JSON 请求，读取 `number` 字段，并返回宿主可解析的 UTF-8 JSON 结果。
- `build.mjs`：调用 `zig cc` 编译 WASM。它不依赖仓库内部测试 helper。

## 工具要求

- Node.js 24 或更新版本，用于运行示例构建脚本和仓库命令。
- Zig 0.17.1 或兼容版本，并能通过 `zig cc` 使用 WebAssembly 链接器。
- 当前仓库的 pnpm 依赖，用于运行宿主执行器集成测试。

本示例使用 `wasm32-freestanding`，不使用 WASI。Apple Clang 即使列出 `wasm32` 目标，也需要可用的 WebAssembly 链接器；当前 macOS 检查环境没有 `wasm-ld`，因此构建命令直接使用 Zig。

## 编译

在仓库根目录运行：

```sh
node plugins/wasm-double/build.mjs
```

默认产物为 `plugins/wasm-double/build/extension.wasm`。构建脚本设置以下边界：

- 只导入宿主的 `env.memory`，初始内存为 16 页，最大为 256 页。
- 将 WASM 栈设为 32 KiB，使静态缓冲区和栈能放入宿主提供的 16 页初始内存。
- 只导出 `alloc(size)`、`execute(pointer, length)` 和 `free(pointer, length)`。
- 不链接 WASI、C 标准库或额外宿主函数。

也可以指定单独的输出文件：

```sh
node plugins/wasm-double/build.mjs --output /tmp/wasm-double.wasm
```

## 宿主执行器验收

此项集成测试需要 Zig。测试会调用示例构建脚本编译 C 源码，再使用生产 `executeExternalExtensionWasmCommand` 检查模块导入、导出和输入输出。普通 `pnpm check` 不会自动启用这项 Zig 依赖。

```sh
IT_TOOLS_WASM_SAMPLE_TEST=1 pnpm exec vitest run plugins/wasm-double/wasm-sample.test.ts --environment node
```

预期结果：请求 `{ "number": 21 }` 返回 `{ "kind": "json", "value": { "input": 21, "doubled": 42 } }`。无效数字也返回 JSON 结果，内容包含 `error` 字段，并与工具声明的结果类型一致。测试结束后会删除临时 WASM 产物。

不设置 `IT_TOOLS_WASM_SAMPLE_TEST=1` 时，测试会跳过，因此没有 Zig 的常规开发环境仍可运行完整测试套件。

## 签名打包与桌面运行

`plugin.manifest.json` 只包含 v2 静态清单字段。v2 打包命令读取该清单，并根据 `--wasm` 指定的编译产物补充运行时、入口文件哈希和 Ed25519 签名。包内入口路径为 `extension.wasm`。私钥必须保存在仓库目录之外。

先在仓库根目录编译，再由 v2 打包命令构建 `.itxs`：

```sh
node plugins/wasm-double/build.mjs
pnpm run plugin:pack:v2 --manifest plugins/wasm-double/plugin.manifest.json --wasm plugins/wasm-double/build/extension.wasm --entrypoint extension.wasm --private-key "$HOME/.config/it-tools/plugin-keys/wasm-double-publisher.private.pem" --key-id wasm-double-publisher --output /tmp/wasm-double.itxs
```

如尚未生成发布密钥，可运行：

```sh
pnpm run plugin:keygen --key-id wasm-double-publisher --output-directory "$HOME/.config/it-tools/plugin-keys"
```

命令会在输出目录生成 `wasm-double-publisher.private.pem` 和 `wasm-double-publisher.public.pem`。不要把私钥复制到仓库。桌面设置中的“Trusted plugin signers”需要填写 key ID、公钥和允许的插件 ID `org.example.wasm.double`；预览指纹并信任签名者后，再从 v2 插件区域选择 `.itxs` 安装。打开“WASM 整数加倍”工具，输入 21 并运行后，应看到 42。

WASM 线性内存有上限，但应用不提供跨平台的进程总内存硬限制。该示例只用于说明纯计算接口，不证明其他 WASM 模块安全或可抵抗进程资源耗尽。
