import type {
  ExternalPluginV2DataProviderDeclaration,
  ExternalPluginV2Manifest,
  ExternalPluginV2ToolDeclaration,
} from '../src/shared/external-plugin-v2';
import type { ExternalExtensionRpcJsonValue } from '../src/shared/desktop-services/external-extension-rpc';
import type { PluginToolInputValueMap } from '../src/shared/plugin-tool-workbench';
import {
  ExternalPluginV2OuiError,
  type ExternalPluginV2OuiErrorCode,
  type ExternalPluginV2OuiLookupResult,
  ExternalPluginV2OuiReader,
} from './external-plugin-v2-oui';

/** v2 数据上下文的边界；它必须小于 RPC 单次消息上限。 */
export const externalPluginV2DataLimits = Object.freeze({
  maximumProviders: 32,
  maximumContextBytes: 12 * 1024,
});

export const externalPluginV2DataErrorCodes = Object.freeze([
  'query-invalid',
  'provider-invalid',
  'resource-limit',
  'provider-unavailable',
  'integrity-mismatch',
  'timeout',
  'cancelled',
] as const);

export type ExternalPluginV2DataErrorCode = typeof externalPluginV2DataErrorCodes[number];

/** 表示宿主数据查询失败；该错误不会把插件包标记为运行时不可用。 */
export class ExternalPluginV2DataError extends Error {
  constructor(
    readonly code: ExternalPluginV2DataErrorCode,
    message: string = code,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ExternalPluginV2DataError';
  }
}

/** 只读取当前工具声明的数据集，并把结果限制在 RPC 可承载的上下文中。 */
export async function readExternalPluginV2ToolData(
  manifest: Pick<ExternalPluginV2Manifest, 'id' | 'contributions'>,
  tool: Pick<ExternalPluginV2ToolDeclaration, 'dataProviders'>,
  input: PluginToolInputValueMap,
  ouiReader: ExternalPluginV2OuiReader,
  signal: AbortSignal,
): Promise<Readonly<Record<string, ExternalExtensionRpcJsonValue>>> {
  const declarations = new Map(manifest.contributions.dataProviders?.map(provider => [provider.id, provider]) ?? []);
  const references = tool.dataProviders ?? [];
  if (references.length > externalPluginV2DataLimits.maximumProviders) {
    throw new ExternalPluginV2DataError('provider-invalid', 'The v2 tool declares too many data providers.');
  }

  const entries: Array<readonly [string, ExternalExtensionRpcJsonValue]> = [];
  for (const reference of references) {
    const declaration = declarations.get(reference.id);
    if (!declaration) {
      throw new ExternalPluginV2DataError('provider-invalid', 'The v2 tool references an unknown data provider.');
    }
    const value = await readProvider(declaration, reference.queryInputId, input, ouiReader, signal);
    const valueBytes = getJsonBytes(value);
    if (valueBytes > declaration.maxBytes) {
      throw new ExternalPluginV2DataError('resource-limit', 'The v2 data provider result exceeds its declared limit.');
    }
    entries.push([reference.id, { vendor: value.vendor, dataVersion: value.dataVersion }]);
    if (getJsonBytes(Object.fromEntries(entries)) > externalPluginV2DataLimits.maximumContextBytes) {
      throw new ExternalPluginV2DataError('resource-limit', 'The v2 data context exceeds its message limit.');
    }
  }
  return Object.freeze(Object.fromEntries(entries));
}

async function readProvider(
  declaration: ExternalPluginV2DataProviderDeclaration,
  queryInputId: string | undefined,
  input: PluginToolInputValueMap,
  ouiReader: ExternalPluginV2OuiReader,
  signal: AbortSignal,
): Promise<ExternalPluginV2OuiLookupResult> {
  if (declaration.kind !== 'oui.vendor' || queryInputId === undefined) {
    throw new ExternalPluginV2DataError('query-invalid', 'The OUI provider requires a query input.');
  }
  if (declaration.schemaVersion !== 1) {
    throw new ExternalPluginV2DataError('provider-invalid', 'The OUI provider schema version is not supported.');
  }
  const query = input[queryInputId];
  if (typeof query !== 'string' || query.trim().length === 0) {
    throw new ExternalPluginV2DataError('query-invalid', 'The OUI provider query must be a non-empty string.');
  }
  try {
    const result = await ouiReader.findVendor(query, signal);
    if (result.dataVersion !== declaration.version) {
      throw new ExternalPluginV2DataError('provider-invalid', 'The OUI provider data version does not match its declaration.');
    }
    return result;
  }
  catch (error) {
    if (error instanceof ExternalPluginV2DataError) {
      throw error;
    }
    throw mapOuiError(error);
  }
}

function mapOuiError(error: unknown): ExternalPluginV2DataError {
  if (!(error instanceof ExternalPluginV2OuiError)) {
    return new ExternalPluginV2DataError('provider-unavailable', 'The OUI provider is unavailable.', { cause: error });
  }
  const code = mapOuiErrorCode(error.code);
  return new ExternalPluginV2DataError(code, error.message, { cause: error });
}

function mapOuiErrorCode(code: ExternalPluginV2OuiErrorCode): ExternalPluginV2DataErrorCode {
  if (code === 'invalid-query') {
    return 'query-invalid';
  }
  if (code === 'resource-limit') {
    return 'resource-limit';
  }
  if (code === 'integrity-mismatch') {
    return 'integrity-mismatch';
  }
  if (code === 'timeout') {
    return 'timeout';
  }
  if (code === 'cancelled') {
    return 'cancelled';
  }
  return 'provider-unavailable';
}

function getJsonBytes(value: unknown): number {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? Number.POSITIVE_INFINITY : new TextEncoder().encode(serialized).byteLength;
}
