import type { PluginV2Manifest } from './plugin-v2-manifest';

export type PluginV2Runtime = 'wasm' | 'process';

export interface PluginV2PackageFile {
  readonly path: string;
  readonly sha256: string;
}

export interface PluginV2PackageSignature {
  readonly algorithm: 'Ed25519';
  readonly keyId: string;
  readonly value: string;
}

/** 安装包清单，签名覆盖静态清单、运行时入口和文件哈希。 */
export interface PluginV2PackageManifest extends PluginV2Manifest {
  readonly runtime: PluginV2Runtime;
  readonly entrypoint: string;
  readonly files: readonly PluginV2PackageFile[];
  readonly signature: PluginV2PackageSignature;
}
