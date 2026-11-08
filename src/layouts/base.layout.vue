<script lang="ts" setup>
import { computed, defineAsyncComponent, ref } from 'vue';
import { NIcon, useThemeVars } from 'naive-ui';

import { RouterLink } from 'vue-router';
import { ArrowUp, Home2, Menu2 } from '@vicons/tabler';

import { storeToRefs } from 'pinia';
import HeroGradient from '../assets/hero-gradient.svg?component';
import MenuLayout from '../components/MenuLayout.vue';
import NavbarButtons from '../components/NavbarButtons.vue';
import { useStyleStore } from '@/stores/style.store';
import { config } from '@/config';
import type { ToolCategory } from '@/tools/tools.types';
import { useToolStore } from '@/tools/tools.store';
import CollapsibleToolMenu from '@/components/CollapsibleToolMenu.vue';
import UpdateNotice from '@/components/UpdateNotice.vue';

const CommandPalette = defineAsyncComponent(() => import('@/modules/command-palette/command-palette.vue'));
const commandPaletteLoaded = ref(false);
const commandPaletteOpen = ref(false);
const isMac = computed(() => window.navigator.userAgent.toLowerCase().includes('mac'));
const commandPaletteKeys = useMagicKeys({
  passive: false,
  onEventFired(event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && event.type === 'keydown') {
      event.preventDefault();
    }
  },
});

whenever(() => commandPaletteKeys.ctrl_k?.value ?? false, openCommandPalette);
whenever(() => commandPaletteKeys.meta_k?.value ?? false, openCommandPalette);

function openCommandPalette() {
  commandPaletteLoaded.value = true;
  commandPaletteOpen.value = true;
}

const themeVars = useThemeVars();
const styleStore = useStyleStore();
const version = config.app.version;
const authorUrl = config.app.authorUrl;
const repositoryUrl = config.app.repositoryUrl;
const fullCommitSha = config.app.lastCommitSha;
const commitSha = fullCommitSha.slice(0, 7);
const versionTag = computed(() => {
  const [calver = '', ...suffixParts] = version.split('-');
  const [year, month, day] = calver.split('.');

  if (!year || !month || !day) {
    return `v${version}`;
  }

  return [
    `v${[year, month.padStart(2, '0'), day.padStart(2, '0')].join('.')}`,
    ...suffixParts,
  ].join('-');
});

const { t } = useI18n();

const toolStore = useToolStore();
const { favoriteTools, toolsByCategory } = storeToRefs(toolStore);

const tools = computed<ToolCategory[]>(() => [
  ...(favoriteTools.value.length > 0
    ? [{ id: 'favorite-tools', name: t('tools.categories.favorite-tools'), components: favoriteTools.value }]
    : []),
  ...toolsByCategory.value,
]);
</script>

<template>
  <MenuLayout class="menu-layout" :class="{ isSmallScreen: styleStore.isSmallScreen }">
    <template #sider>
      <RouterLink to="/" class="hero-wrapper">
        <HeroGradient class="gradient" />
        <div class="text-wrapper">
          <div class="title">
            IT - TOOLS
          </div>
          <div class="divider" />
          <div class="subtitle">
            {{ $t('home.subtitle') }}
          </div>
        </div>
      </RouterLink>

      <div class="sider-content">
        <div v-if="styleStore.isSmallScreen" class="sider-preferences">
          <locale-selector w="90%" />
        </div>

        <CollapsibleToolMenu :tools-by-category="tools" />

        <div class="footer">
          <div>
            IT-Tools

            <c-link target="_blank" rel="noopener" :href="`${repositoryUrl}/tree/${versionTag}`">
              v{{ version }}
            </c-link>

            <template v-if="commitSha && commitSha.length > 0">
              -
              <c-link target="_blank" rel="noopener" type="primary" :href="`${repositoryUrl}/commit/${fullCommitSha}`">
                {{ commitSha }}
              </c-link>
            </template>
          </div>
          <div>
            © {{ new Date().getFullYear() }}
            <c-link target="_blank" rel="noopener" :href="`${authorUrl}`">
              likanug
            </c-link>
          </div>
        </div>
      </div>
    </template>

    <template #header="{ scrollToTop }">
      <nav class="top-navigation" :aria-label="$t('home.nav.navigation')">
        <div class="navigation-start">
          <c-button
            circle
            variant="text"
            :aria-label="$t('home.toggleMenu')"
            aria-controls="tool-navigation"
            :aria-expanded="!styleStore.isMenuCollapsed"
            :title="$t('home.toggleMenu')"
            @click="styleStore.isMenuCollapsed = !styleStore.isMenuCollapsed"
          >
            <NIcon size="22" :component="Menu2" />
          </c-button>

          <c-tooltip :tooltip="$t('home.home')" position="bottom">
            <c-button to="/" circle variant="text" :aria-label="$t('home.home')">
              <NIcon size="22" :component="Home2" />
            </c-button>
          </c-tooltip>
        </div>

        <c-button class="navigation-search" :aria-label="$t('search.label')" :title="$t('search.label')" @click="openCommandPalette">
          <span class="navigation-search-label">
            <icon-mdi-search />
            <span class="navigation-search-text">{{ $t('search.label') }}</span>
          </span>
          <kbd class="navigation-shortcut">{{ isMac ? 'Cmd' : 'Ctrl' }} + K</kbd>
        </c-button>
        <CommandPalette v-if="commandPaletteLoaded" v-model:open="commandPaletteOpen" />

        <NavbarButtons />
        <c-tooltip class="navigation-back-to-top" :tooltip="$t('home.nav.backToTop')" position="bottom">
          <c-button
            circle
            variant="text"
            :aria-label="$t('home.nav.backToTop')"
            @click="scrollToTop"
          >
            <NIcon size="22" :component="ArrowUp" />
          </c-button>
        </c-tooltip>
      </nav>
      <UpdateNotice />
    </template>

    <template #content>
      <slot />
    </template>
  </MenuLayout>
</template>

<style lang="less" scoped>
.top-navigation {
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 12px;
  box-sizing: border-box;
  min-height: 64px;
  padding: 8px var(--layout-scroll-padding, 26px);
  background: v-bind('themeVars.bodyColor');
  border-bottom: 1px solid v-bind('themeVars.borderColor');

  :deep(.c-button.circle) {
    width: 36px;
    height: 36px;
    border-radius: 8px;
  }

  @container navigation (max-width: 700px) {
    gap: 4px;
    padding-inline: 8px;
  }
}

.navigation-start {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 4px;
}

.navigation-search {
  flex: 1 1 0;
  min-width: 36px;
  height: 36px;
  justify-content: space-between;
  gap: 12px;
  border-radius: 8px;

  @container navigation (max-width: 520px) {
    justify-content: center;
    padding-inline: 0;
  }
}

.navigation-search-label {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  white-space: nowrap;
  opacity: 0.65;

  svg {
    flex: 0 0 auto;
  }

  @container navigation (max-width: 520px) {
    gap: 0;
  }
}

.navigation-search-text {
  @container navigation (max-width: 520px) {
    display: none;
  }
}

.navigation-shortcut {
  flex: 0 0 auto;
  padding: 3px 5px;
  border: 1px solid v-bind('themeVars.borderColor');
  border-radius: 4px;
  font: inherit;
  font-size: 12px;
  opacity: 0.6;

  @container navigation (max-width: 800px) {
    display: none;
  }
}

.navigation-back-to-top {
  flex: 0 0 auto;
  padding-left: 8px;
  border-left: 1px solid v-bind('themeVars.borderColor');

  @container navigation (max-width: 700px) {
    padding-left: 4px;
  }
}

.sider-preferences {
  display: flex;
  justify-content: center;
  margin-bottom: 12px;
}

.footer {
  text-align: center;
  color: #838587;
  margin-top: 20px;
  padding: 20px 0;
}

.sider-content {
  padding-top: 160px;
  padding-bottom: 200px;
}

.hero-wrapper {
  position: absolute;
  display: block;
  left: 0;
  width: 100%;
  z-index: 10;
  overflow: hidden;

  .gradient {
    margin-top: -65px;
  }

  .text-wrapper {
    position: absolute;
    left: 0;
    width: 100%;
    text-align: center;
    top: 16px;
    color: #fff;

    .title {
      font-size: 25px;
      font-weight: 600;
    }

    .divider {
      width: 50px;
      height: 2px;
      border-radius: 4px;
      background-color: v-bind('themeVars.primaryColor');
      margin: 0 auto 5px;
    }

    .subtitle {
      font-size: 16px;
    }
  }
}
</style>
