# 依赖安全补丁

核对日期：2026-10-18。官方 npm 审计仍按上游版本报告以下问题；本项目使用锁文件固定的本地补丁。补丁不能让版本扫描自动归零。国内镜像没有审计接口，因此审计命令单独指定官方 registry，不修改全局镜像配置。

| 依赖与公告 | 本地处理 | 回归证据 |
| --- | --- | --- |
| node-forge 1.4.0，[GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | RSA DigestInfo 必须匹配规范 DER，拒绝算法序列中的多余元素 | 正常的有 NULL 和无 NULL 编码通过，多余 NULL 和 OCTET STRING 编码被拒绝 |
| sprintf-js 1.1.3，[GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) | 将旧传递版本统一至 1.1.3，格式宽度和精度各限制为 10,000，超限在分配前抛出 RangeError | 使用 composerize-ts → yamljs → argparse 的实际依赖链验证正常格式及超限拒绝 |

执行 `pnpm test:dependency-security` 运行补丁回归。`pnpm check` 包含该检查。执行 `pnpm audit --prod --registry=https://registry.npmjs.org` 可以复核上游公告；截至本次核对，两项公告均没有可升级的修复版本。

回滚边界：不能单独移除 `patchedDependencies`。上游发布修复后，更新依赖并在相同恶意输入回归通过后删除对应补丁。sprintf-js 的限制只约束格式指定的宽度和精度，不构成任意输入或总输出内存上限。
