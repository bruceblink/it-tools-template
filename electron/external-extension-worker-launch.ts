import { isAbsolute } from 'node:path';

export interface ExternalExtensionWorkerLaunchConfig {
  readonly pluginId: string;
  readonly version: string;
  readonly packageRoot: string;
  readonly entrypoint: string;
  readonly entrypointSha256: string;
}

const argumentPrefix = '--it-tools-v2-launch=';
const pluginIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const entrypointPattern = /^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.wasm$/i;
const sha256Pattern = /^[a-f0-9]{64}$/;
const maximumArgumentBytes = 8192;

/** 将已通过包管理器校验的入口信息编码为单个 worker 参数。 */
export function encodeExternalExtensionWorkerLaunchArgument(config: ExternalExtensionWorkerLaunchConfig): string {
  if (!isLaunchConfig(config)) {
    throw new TypeError('The external extension worker launch configuration is invalid.');
  }
  const encoded = Buffer.from(JSON.stringify(config), 'utf8').toString('base64url');
  const argument = `${argumentPrefix}${encoded}`;
  if (Buffer.byteLength(argument, 'utf8') > maximumArgumentBytes) {
    throw new RangeError('The external extension worker launch configuration is too large.');
  }
  return argument;
}

/** 从 utility process 参数读取唯一的 v2 启动配置。 */
export function parseExternalExtensionWorkerLaunchArguments(
  args: readonly string[],
): ExternalExtensionWorkerLaunchConfig | undefined {
  const matches = args.filter(argument => argument.startsWith(argumentPrefix));
  if (matches.length !== 1 || Buffer.byteLength(matches[0]!, 'utf8') > maximumArgumentBytes) {
    return undefined;
  }
  try {
    const encoded = matches[0]!.slice(argumentPrefix.length);
    const bytes = Buffer.from(encoded, 'base64url');
    if (bytes.toString('base64url') !== encoded) {
      return undefined;
    }
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
    return isLaunchConfig(parsed) ? parsed : undefined;
  }
  catch {
    return undefined;
  }
}

function isLaunchConfig(value: unknown): value is ExternalExtensionWorkerLaunchConfig {
  if (!isRecord(value)
    || Object.keys(value).length !== 5
    || typeof value.pluginId !== 'string'
    || !pluginIdPattern.test(value.pluginId)
    || typeof value.version !== 'string'
    || !versionPattern.test(value.version)
    || typeof value.packageRoot !== 'string'
    || value.packageRoot.length > 4096
    || !isAbsolute(value.packageRoot)
    || typeof value.entrypoint !== 'string'
    || !entrypointPattern.test(value.entrypoint)
    || value.entrypoint.split('/').some(segment => segment === '.' || segment === '..')
    || typeof value.entrypointSha256 !== 'string'
    || !sha256Pattern.test(value.entrypointSha256)) {
    return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
