<script setup lang="ts">
import { NAlert, NButton, NCard, NEmpty, NInput, NModal, NSelect, NSpin, NTag, NText } from 'naive-ui';
import { useHead } from '@unhead/vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  fetchPluginManifest,
  pluginMarketplaceConfig,
  PluginMarketplaceApiError,
  searchPluginRepositories,
  type PluginManifestSummary,
  type PluginMarketplaceRepository,
  type PluginMarketplaceSort,
} from '@/modules/plugin-marketplace/plugin-marketplace.service';

const { locale, t } = useI18n();
useHead({ title: computed(() => t('pluginMarketplace.pageTitle')) });
const searchInput = ref('');
const sort = ref<PluginMarketplaceSort>('updated');
const repositories = ref<PluginMarketplaceRepository[]>([]);
const totalCount = ref(0);
const incompleteResults = ref(false);
const hasNextPage = ref(false);
const currentPage = ref(0);
const loading = ref(false);
const loadingMore = ref(false);
const errorMessage = ref('');
const selectedRepository = ref<PluginMarketplaceRepository>();
const selectedManifest = ref<PluginManifestSummary | null>();
const manifestLoading = ref(false);
const manifestError = ref('');
const detailsVisible = ref(false);

let repositoryController: AbortController | undefined;
let manifestController: AbortController | undefined;
let requestSequence = 0;

const sortOptions = computed(() => [
  { label: t('pluginMarketplace.sort.updated'), value: 'updated' as const },
  { label: t('pluginMarketplace.sort.stars'), value: 'stars' as const },
  { label: t('pluginMarketplace.sort.forks'), value: 'forks' as const },
  { label: t('pluginMarketplace.sort.relevance'), value: 'best-match' as const },
]);

const sourceDescription = computed(() => t('pluginMarketplace.sourceDescription', {
  topic: pluginMarketplaceConfig.topic,
}));

const visibleCountLabel = computed(() => t('pluginMarketplace.resultCount', {
  count: new Intl.NumberFormat(locale.value).format(totalCount.value),
}));

function formatCount(value: number): string {
  return new Intl.NumberFormat(locale.value, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return t('pluginMarketplace.unknownDate');
  }
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(parsed);
}

function repositoryTopics(repository: PluginMarketplaceRepository): readonly string[] {
  return repository.topics
    .filter(topic => topic !== pluginMarketplaceConfig.topic)
    .slice(0, 5);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof PluginMarketplaceApiError) {
    if (error.status === 403 || error.status === 429) {
      return error.rateLimitResetAt
        ? t('pluginMarketplace.errors.rateLimitUntil', { time: formatDate(error.rateLimitResetAt.toISOString()) })
        : t('pluginMarketplace.errors.rateLimit');
    }
    if (error.status === 404) {
      return t('pluginMarketplace.errors.notFound');
    }
  }
  return t('pluginMarketplace.errors.unavailable');
}

async function loadRepositories(append = false): Promise<void> {
  if (append && !hasNextPage.value) {
    return;
  }
  repositoryController?.abort();
  const controller = new AbortController();
  repositoryController = controller;
  const sequence = ++requestSequence;
  const page = append ? currentPage.value + 1 : 1;
  if (append) {
    loadingMore.value = true;
  }
  else {
    loading.value = true;
    errorMessage.value = '';
  }

  try {
    const result = await searchPluginRepositories({
      search: searchInput.value,
      sort: sort.value,
      page,
      perPage: 24,
      signal: controller.signal,
    });
    if (sequence !== requestSequence) {
      return;
    }
    repositories.value = append
      ? [...repositories.value, ...result.repositories]
      : [...result.repositories];
    totalCount.value = result.totalCount;
    incompleteResults.value = result.incompleteResults;
    hasNextPage.value = result.hasNextPage;
    currentPage.value = result.page;
  }
  catch (error) {
    if (controller.signal.aborted) {
      return;
    }
    errorMessage.value = getErrorMessage(error);
    if (!append) {
      repositories.value = [];
      totalCount.value = 0;
      hasNextPage.value = false;
    }
  }
  finally {
    if (sequence === requestSequence) {
      loading.value = false;
      loadingMore.value = false;
    }
  }
}

function submitSearch(): void {
  void loadRepositories();
}

function resetSearch(): void {
  if (searchInput.value.length === 0) {
    void loadRepositories();
  }
}

async function showDetails(repository: PluginMarketplaceRepository): Promise<void> {
  manifestController?.abort();
  const controller = new AbortController();
  manifestController = controller;
  selectedRepository.value = repository;
  selectedManifest.value = undefined;
  manifestError.value = '';
  detailsVisible.value = true;
  manifestLoading.value = true;
  try {
    selectedManifest.value = await fetchPluginManifest(repository, controller.signal);
  }
  catch (error) {
    if (!controller.signal.aborted) {
      manifestError.value = getErrorMessage(error);
    }
  }
  finally {
    if (!controller.signal.aborted) {
      manifestLoading.value = false;
    }
  }
}

function closeDetails(): void {
  detailsVisible.value = false;
  manifestController?.abort();
}

watch(sort, () => {
  void loadRepositories();
});

onMounted(() => {
  void loadRepositories();
});

onBeforeUnmount(() => {
  repositoryController?.abort();
  manifestController?.abort();
});
</script>

<template>
  <main class="plugin-marketplace">
    <section class="marketplace-hero" aria-labelledby="plugin-marketplace-title">
      <div class="marketplace-hero-copy">
        <p class="marketplace-eyebrow">{{ t('pluginMarketplace.eyebrow') }}</p>
        <h1 id="plugin-marketplace-title">{{ t('pluginMarketplace.title') }}</h1>
        <p class="marketplace-intro">{{ t('pluginMarketplace.intro') }}</p>
      </div>
      <div class="marketplace-hero-actions">
        <n-button
          tag="a"
          :href="pluginMarketplaceConfig.apiBaseUrl"
          target="_blank"
          rel="noopener noreferrer"
          secondary
        >
          {{ t('pluginMarketplace.openApi') }}
        </n-button>
      </div>
    </section>

    <n-alert class="marketplace-source-note" type="info" :show-icon="false">
      {{ sourceDescription }}
    </n-alert>

    <form class="marketplace-toolbar" role="search" @submit.prevent="submitSearch">
      <n-input
        v-model:value="searchInput"
        clearable
        :placeholder="t('pluginMarketplace.searchPlaceholder')"
        :aria-label="t('pluginMarketplace.searchLabel')"
        @clear="resetSearch"
      />
      <n-select
        v-model:value="sort"
        :options="sortOptions"
        :aria-label="t('pluginMarketplace.sortLabel')"
      />
      <n-button attr-type="submit" type="primary" :loading="loading">
        {{ t('pluginMarketplace.search') }}
      </n-button>
    </form>

    <div class="marketplace-summary">
      <n-text depth="3">{{ visibleCountLabel }}</n-text>
      <n-text v-if="incompleteResults" depth="3">{{ t('pluginMarketplace.incompleteResults') }}</n-text>
    </div>

    <n-alert v-if="errorMessage" class="marketplace-error" type="error" :show-icon="false" role="alert">
      <div class="marketplace-error-content">
        <span>{{ errorMessage }}</span>
        <n-button size="small" secondary @click="loadRepositories()">
          {{ t('pluginMarketplace.retry') }}
        </n-button>
      </div>
    </n-alert>

    <n-spin :show="loading">
      <n-empty
        v-if="!loading && repositories.length === 0 && !errorMessage"
        class="marketplace-empty"
        :description="t('pluginMarketplace.empty')"
      />

      <div v-else class="repository-grid">
        <n-card
          v-for="repository in repositories"
          :key="repository.id"
          class="repository-card"
          :data-test-id="'plugin-repository-' + repository.id"
        >
          <template #header>
            <div class="repository-heading">
              <div>
                <p class="repository-owner">{{ repository.ownerLogin }}</p>
                <h2>{{ repository.name }}</h2>
              </div>
              <n-tag v-if="repository.language" size="small" round>{{ repository.language }}</n-tag>
            </div>
          </template>

          <p class="repository-description">
            {{ repository.description || t('pluginMarketplace.noDescription') }}
          </p>

          <div v-if="repositoryTopics(repository).length > 0" class="repository-topics">
            <n-tag v-for="topic in repositoryTopics(repository)" :key="topic" size="small" :bordered="false">
              {{ topic }}
            </n-tag>
          </div>

          <div class="repository-stats" :aria-label="t('pluginMarketplace.repositoryStats')">
            <span><strong aria-hidden="true">★</strong> {{ formatCount(repository.stars) }}</span>
            <span><strong aria-hidden="true">⑂</strong> {{ formatCount(repository.forks) }}</span>
            <span>{{ t('pluginMarketplace.updatedAt', { date: formatDate(repository.updatedAt) }) }}</span>
          </div>

          <template #footer>
            <div class="repository-actions">
              <n-button size="small" @click="showDetails(repository)">
                {{ t('pluginMarketplace.details') }}
              </n-button>
              <n-button
                tag="a"
                size="small"
                type="primary"
                :href="repository.htmlUrl"
                target="_blank"
                rel="noopener noreferrer"
              >
                {{ t('pluginMarketplace.openRepository') }}
              </n-button>
            </div>
          </template>
        </n-card>
      </div>
    </n-spin>

    <div v-if="hasNextPage" class="marketplace-load-more">
      <n-button :loading="loadingMore" secondary @click="loadRepositories(true)">
        {{ t('pluginMarketplace.loadMore') }}
      </n-button>
    </div>

    <n-modal v-model:show="detailsVisible" preset="card" class="repository-modal" @close="closeDetails">
      <template #header>
        <div v-if="selectedRepository" class="repository-modal-heading">
          <div>
            <p class="repository-owner">{{ selectedRepository.ownerLogin }}</p>
            <h2>{{ selectedRepository.name }}</h2>
          </div>
          <n-button text @click="closeDetails" :aria-label="t('pluginMarketplace.closeDetails')">
            ×
          </n-button>
        </div>
      </template>

      <template v-if="selectedRepository">
        <p class="repository-description">
          {{ selectedRepository.description || t('pluginMarketplace.noDescription') }}
        </p>
        <div class="repository-detail-list">
          <div>
            <span>{{ t('pluginMarketplace.detailRepository') }}</span>
            <a :href="selectedRepository.htmlUrl" target="_blank" rel="noopener noreferrer">
              {{ selectedRepository.fullName }}
            </a>
          </div>
          <div>
            <span>{{ t('pluginMarketplace.detailLicense') }}</span>
            <strong>{{ selectedRepository.license || t('pluginMarketplace.unknown') }}</strong>
          </div>
          <div>
            <span>{{ t('pluginMarketplace.detailUpdated') }}</span>
            <strong>{{ formatDate(selectedRepository.updatedAt) }}</strong>
          </div>
        </div>

        <n-spin :show="manifestLoading">
          <n-alert v-if="manifestError" type="warning" :show-icon="false">
            {{ manifestError }}
          </n-alert>
          <n-alert v-else-if="selectedManifest === null" type="warning" :show-icon="false">
            {{ t('pluginMarketplace.manifestMissing') }}
          </n-alert>
          <div v-else-if="selectedManifest" class="manifest-summary">
            <div class="manifest-summary-heading">
              <div>
                <p class="repository-owner">{{ t('pluginMarketplace.manifestLabel') }}</p>
                <h3>{{ selectedManifest.name }} · {{ selectedManifest.version }}</h3>
              </div>
              <n-tag size="small" type="success">
                API {{ selectedManifest.apiVersion.minInclusive }} – {{ selectedManifest.apiVersion.maxExclusive }}
              </n-tag>
            </div>
            <p>{{ t('pluginMarketplace.manifestNotice') }}</p>
            <div v-if="selectedManifest.requestedCapabilities.length > 0" class="repository-topics">
              <n-tag v-for="capability in selectedManifest.requestedCapabilities" :key="capability" size="small">
                {{ capability }}
              </n-tag>
            </div>
            <ul v-if="selectedManifest.toolContributions.length > 0" class="manifest-tools">
              <li v-for="tool in selectedManifest.toolContributions" :key="tool.id">
                <strong>{{ tool.title }}</strong>
                <span>{{ tool.description }}</span>
              </li>
            </ul>
          </div>
        </n-spin>
      </template>

      <template #footer>
        <div v-if="selectedRepository" class="repository-actions">
          <n-button
            tag="a"
            :href="selectedRepository.htmlUrl + '#readme'"
            target="_blank"
            rel="noopener noreferrer"
          >
            {{ t('pluginMarketplace.readReadme') }}
          </n-button>
          <n-button
            tag="a"
            type="primary"
            :href="selectedRepository.htmlUrl"
            target="_blank"
            rel="noopener noreferrer"
          >
            {{ t('pluginMarketplace.openRepository') }}
          </n-button>
        </div>
      </template>
    </n-modal>
  </main>
</template>

<style scoped lang="less">
.plugin-marketplace {
  width: min(1180px, 100%);
  margin: 0 auto;
  padding: 32px 0 64px;
}

.marketplace-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 22px;
}

.marketplace-hero-copy {
  max-width: 760px;
}

.marketplace-eyebrow,
.repository-owner {
  margin: 0 0 6px;
  color: var(--n-text-color-3);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.marketplace-hero h1 {
  margin: 0;
  font-size: clamp(30px, 5vw, 48px);
  line-height: 1.08;
}

.marketplace-intro {
  max-width: 680px;
  margin: 14px 0 0;
  color: var(--n-text-color-2);
  font-size: 16px;
  line-height: 1.6;
}

.marketplace-source-note {
  margin-bottom: 18px;
}

.marketplace-toolbar {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) 190px auto;
  gap: 10px;
  margin-bottom: 12px;
}

.marketplace-summary {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin: 8px 0 16px;
}

.marketplace-error-content,
.repository-heading,
.repository-actions,
.repository-modal-heading,
.manifest-summary-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.marketplace-empty {
  min-height: 240px;
  padding: 64px 0;
}

.repository-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 310px), 1fr));
  gap: 14px;
}

.repository-card {
  height: 100%;
}

.repository-card :deep(.n-card__content) {
  display: flex;
  min-height: 190px;
  flex-direction: column;
}

.repository-heading {
  align-items: flex-start;
}

.repository-heading h2,
.repository-modal-heading h2,
.manifest-summary-heading h3 {
  margin: 0;
  overflow-wrap: anywhere;
}

.repository-description {
  flex: 1 1 auto;
  margin: 0 0 18px;
  color: var(--n-text-color-2);
  line-height: 1.55;
}

.repository-topics {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 16px;
}

.repository-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  color: var(--n-text-color-3);
  font-size: 12px;
}

.repository-actions {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.marketplace-load-more {
  display: flex;
  justify-content: center;
  padding: 24px 0 0;
}

.repository-modal {
  width: min(720px, calc(100vw - 32px));
}

.repository-detail-list {
  display: grid;
  gap: 10px;
  margin: 22px 0;
}

.repository-detail-list > div {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--n-divider-color);
}

.repository-detail-list span {
  color: var(--n-text-color-3);
}

.manifest-summary {
  padding: 16px;
  border: 1px solid var(--n-border-color);
  border-radius: 10px;
}

.manifest-summary-heading {
  align-items: flex-start;
  margin-bottom: 12px;
}

.manifest-summary p {
  margin: 0 0 12px;
  color: var(--n-text-color-2);
  line-height: 1.5;
}

.manifest-tools {
  display: grid;
  gap: 10px;
  margin: 14px 0 0;
  padding-left: 20px;
}

.manifest-tools li {
  display: grid;
  gap: 2px;
}

.manifest-tools span {
  color: var(--n-text-color-2);
}

@media (max-width: 720px) {
  .plugin-marketplace {
    padding-top: 20px;
  }

  .marketplace-hero {
    align-items: flex-start;
    flex-direction: column;
  }

  .marketplace-toolbar {
    grid-template-columns: 1fr;
  }

  .marketplace-summary {
    align-items: flex-start;
    flex-direction: column;
  }
}

@media (prefers-reduced-motion: reduce) {
  .repository-card {
    transition: none;
  }
}
</style>
