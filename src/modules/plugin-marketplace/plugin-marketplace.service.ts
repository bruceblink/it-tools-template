export type PluginMarketplaceSort = 'best-match' | 'updated' | 'stars' | 'forks';

export interface PluginMarketplaceRepository {
  readonly id: number;
  readonly fullName: string;
  readonly name: string;
  readonly ownerLogin: string;
  readonly htmlUrl: string;
  readonly description: string | null;
  readonly homepage: string | null;
  readonly topics: readonly string[];
  readonly language: string | null;
  readonly license: string | null;
  readonly stars: number;
  readonly forks: number;
  readonly openIssues: number;
  readonly updatedAt: string;
  readonly pushedAt: string;
  readonly defaultBranch: string;
  readonly archived: boolean;
  readonly disabled: boolean;
}

export interface PluginMarketplaceSearchResult {
  readonly repositories: readonly PluginMarketplaceRepository[];
  readonly totalCount: number;
  readonly incompleteResults: boolean;
  readonly page: number;
  readonly perPage: number;
  readonly hasNextPage: boolean;
}

export interface PluginMarketplaceSearchOptions {
  readonly search?: string;
  readonly sort?: PluginMarketplaceSort;
  readonly page?: number;
  readonly perPage?: number;
  readonly signal?: AbortSignal;
}

export interface PluginManifestToolContribution {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly capabilities: readonly string[];
}

export interface PluginManifestSummary {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly apiVersion: {
    readonly minInclusive: string;
    readonly maxExclusive: string;
  };
  readonly entrypoint: string;
  readonly requestedCapabilities: readonly string[];
  readonly toolContributions: readonly PluginManifestToolContribution[];
}

export class PluginMarketplaceApiError extends Error {
  readonly status: number | undefined;
  readonly rateLimitResetAt: Date | undefined;

  constructor(message: string, options: { status?: number; rateLimitResetAt?: Date } = {}) {
    super(message);
    this.name = 'PluginMarketplaceApiError';
    this.status = options.status;
    this.rateLimitResetAt = options.rateLimitResetAt;
  }
}

const defaultApiBaseUrl = 'https://api.github.com';
const defaultTopic = 'it-tools-plugin';
const githubApiVersion = '2022-11-28';
const maximumSearchTermLength = 120;
const maximumPageSize = 100;

function normalizeApiBaseUrl(value: string | undefined): string {
  const candidate = value?.trim() || defaultApiBaseUrl;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      return defaultApiBaseUrl;
    }
    return url.origin + url.pathname.replace(/\/$/, '');
  }
  catch {
    return defaultApiBaseUrl;
  }
}

function normalizeTopic(value: string | undefined): string {
  const topic = value?.trim().toLowerCase() || defaultTopic;
  return /^[a-z0-9][a-z0-9-]{0,49}$/.test(topic) ? topic : defaultTopic;
}

function normalizeOwner(value: string | undefined): string | undefined {
  const owner = value?.trim();
  if (!owner || !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/.test(owner)) {
    return undefined;
  }
  return owner;
}

export const pluginMarketplaceConfig = Object.freeze({
  apiBaseUrl: normalizeApiBaseUrl(import.meta.env.VITE_PLUGIN_MARKETPLACE_API_BASE),
  topic: normalizeTopic(import.meta.env.VITE_PLUGIN_MARKETPLACE_TOPIC),
  owner: normalizeOwner(import.meta.env.VITE_PLUGIN_MARKETPLACE_OWNER),
});

function createApiUrl(path: string): URL {
  const base = pluginMarketplaceConfig.apiBaseUrl.endsWith('/')
    ? pluginMarketplaceConfig.apiBaseUrl
    : pluginMarketplaceConfig.apiBaseUrl + '/';
  return new URL(path.replace(/^\/+/, ''), base);
}

function clampPageSize(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 24;
  }
  return Math.min(maximumPageSize, Math.max(1, Math.floor(value as number)));
}

function normalizePage(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.floor(value as number));
}

export function buildPluginSearchQuery(
  search = '',
  options: Pick<typeof pluginMarketplaceConfig, 'topic' | 'owner'> = pluginMarketplaceConfig,
): string {
  const terms = ['topic:' + options.topic, 'archived:false', 'fork:false'];
  if (options.owner) {
    terms.push('user:' + options.owner);
  }
  const normalizedSearch = search.trim().replace(/\s+/g, ' ').slice(0, maximumSearchTermLength);
  if (normalizedSearch) {
    terms.push(normalizedSearch);
  }
  return terms.join(' ');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asHttpsUrl(value: unknown): string | null {
  const text = asString(value);
  if (!text) {
    return null;
  }
  try {
    const url = new URL(text);
    return url.protocol === 'https:' ? url.href : null;
  }
  catch {
    return null;
  }
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function normalizeRepository(value: unknown): PluginMarketplaceRepository | null {
  const record = asRecord(value);
  const owner = asRecord(record?.owner);
  const id = asNumber(record?.id, -1);
  const fullName = asString(record?.full_name);
  const name = asString(record?.name);
  const ownerLogin = asString(owner?.login);
  const htmlUrl = asHttpsUrl(record?.html_url);
  if (id < 0 || !fullName || !name || !ownerLogin || !htmlUrl) {
    return null;
  }

  const topics = Array.isArray(record?.topics)
    ? record.topics.filter((topic): topic is string => typeof topic === 'string' && topic.length > 0)
    : [];
  const license = asRecord(record?.license);

  return {
    id,
    fullName,
    name,
    ownerLogin,
    htmlUrl,
    description: asString(record?.description),
    homepage: asHttpsUrl(record?.homepage),
    topics,
    language: asString(record?.language),
    license: asString(license?.spdx_id) ?? asString(license?.name),
    stars: asNumber(record?.stargazers_count),
    forks: asNumber(record?.forks_count),
    openIssues: asNumber(record?.open_issues_count),
    updatedAt: asString(record?.updated_at) ?? '',
    pushedAt: asString(record?.pushed_at) ?? '',
    defaultBranch: asString(record?.default_branch) ?? 'main',
    archived: asBoolean(record?.archived),
    disabled: asBoolean(record?.disabled),
  };
}

function getRateLimitResetAt(headers: Headers): Date | undefined {
  const reset = Number(headers.get('x-ratelimit-reset'));
  return Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000) : undefined;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = asRecord(await response.json());
    return asString(payload?.message) ?? response.statusText;
  }
  catch {
    return response.statusText;
  }
}

async function fetchJson<T>(url: URL, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': githubApiVersion,
      },
      signal,
    });
  }
  catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new PluginMarketplaceApiError('The plugin marketplace API could not be reached.');
  }

  if (!response.ok) {
    const detail = await readErrorMessage(response);
    throw new PluginMarketplaceApiError(detail || 'GitHub API request failed with status ' + response.status + '.', {
      status: response.status,
      rateLimitResetAt: getRateLimitResetAt(response.headers),
    });
  }
  return await response.json() as T;
}

interface GithubSearchResponse {
  readonly total_count?: unknown;
  readonly incomplete_results?: unknown;
  readonly items?: unknown;
}

export async function searchPluginRepositories(
  options: PluginMarketplaceSearchOptions = {},
): Promise<PluginMarketplaceSearchResult> {
  const page = normalizePage(options.page);
  const perPage = clampPageSize(options.perPage);
  const sort = options.sort ?? 'updated';
  const query = new URLSearchParams({
    q: buildPluginSearchQuery(options.search),
    page: String(page),
    per_page: String(perPage),
  });
  if (sort !== 'best-match') {
    query.set('sort', sort);
    query.set('order', 'desc');
  }

  const endpoint = createApiUrl('search/repositories');
  endpoint.search = query.toString();
  const payload = await fetchJson<GithubSearchResponse>(endpoint, options.signal);
  const repositories = Array.isArray(payload.items)
    ? payload.items.map(normalizeRepository).filter((repository): repository is PluginMarketplaceRepository => repository !== null)
    : [];
  const totalCount = Math.max(0, Math.floor(asNumber(payload.total_count)));
  return {
    repositories,
    totalCount,
    incompleteResults: payload.incomplete_results === true,
    page,
    perPage,
    hasNextPage: page * perPage < Math.min(totalCount, 1000),
  };
}

interface GithubContentResponse {
  readonly type?: unknown;
  readonly encoding?: unknown;
  readonly content?: unknown;
}

function decodeBase64Utf8(value: string): string {
  const binary = atob(value.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function normalizeManifest(value: unknown): PluginManifestSummary | null {
  const record = asRecord(value);
  const apiVersion = asRecord(record?.apiVersion);
  const id = asString(record?.id);
  const name = asString(record?.name);
  const version = asString(record?.version);
  const minInclusive = asString(apiVersion?.minInclusive);
  const maxExclusive = asString(apiVersion?.maxExclusive);
  const entrypoint = asString(record?.entrypoint);
  if (!id || !name || !version || !minInclusive || !maxExclusive || !entrypoint) {
    return null;
  }

  const requestedCapabilities = Array.isArray(record?.requestedCapabilities)
    ? record.requestedCapabilities.filter((item): item is string => typeof item === 'string')
    : [];
  const contributions = asRecord(record?.contributions);
  const tools = Array.isArray(contributions?.tools) ? contributions.tools : [];
  const toolContributions = tools
    .map((tool): PluginManifestToolContribution | null => {
      const item = asRecord(tool);
      const toolId = asString(item?.id);
      const title = asString(item?.title);
      const description = asString(item?.description);
      if (!toolId || !title || !description) {
        return null;
      }
      const capabilities = Array.isArray(item?.capabilities)
        ? item.capabilities.filter((capability): capability is string => typeof capability === 'string')
        : [];
      return { id: toolId, title, description, capabilities };
    })
    .filter((tool): tool is PluginManifestToolContribution => tool !== null);

  return {
    id,
    name,
    version,
    apiVersion: { minInclusive, maxExclusive },
    entrypoint,
    requestedCapabilities,
    toolContributions,
  };
}

export async function fetchPluginManifest(
  repository: PluginMarketplaceRepository,
  signal?: AbortSignal,
): Promise<PluginManifestSummary | null> {
  const [owner, name] = repository.fullName.split('/');
  if (!owner || !name) {
    return null;
  }
  const endpoint = createApiUrl(
    'repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(name) + '/contents/plugin.source.json',
  );
  endpoint.searchParams.set('ref', repository.defaultBranch);
  try {
    const payload = await fetchJson<GithubContentResponse>(endpoint, signal);
    if (payload.type !== 'file' || payload.encoding !== 'base64' || typeof payload.content !== 'string') {
      return null;
    }
    return normalizeManifest(JSON.parse(decodeBase64Utf8(payload.content)));
  }
  catch (error) {
    if (error instanceof PluginMarketplaceApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}
