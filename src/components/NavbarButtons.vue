<script setup lang="ts">
import { h } from 'vue';
import { NDropdown, NIcon, type DropdownOption, useThemeVars } from 'naive-ui';
import { IconBrandGithub, IconBrush, IconDots, IconHeart, IconInfoCircle, IconMoon, IconPuzzle, IconSettings, IconSun } from '@tabler/icons-vue';
import { useStyleStore } from '@/stores/style.store';
import { useTracker } from '@/modules/tracker/tracker.services';
import { config } from '@/config';

const styleStore = useStyleStore();
const { isDarkTheme, isSmallScreen } = toRefs(styleStore);
const themeVars = useThemeVars();
const navigationWidth = ref(0);
const navbarActions = ref<HTMLElement | null>(null);
const { t } = useI18n();
const router = useRouter();
const { tracker } = useTracker();
const repositoryUrl = config.app.repositoryUrl;
const sponsoringUrl = config.app.sponsoringUrl;
const moreOpen = ref(false);
const showUiLibrary = import.meta.env.DEV;
const compactPreferences = computed(() => isSmallScreen.value || (navigationWidth.value > 0 && navigationWidth.value <= 640));

onMounted(() => {
  const navigation = navbarActions.value?.closest<HTMLElement>('.top-navigation');
  if (!navigation) {
    return;
  }
  useResizeObserver(navigation, ([entry]) => {
    navigationWidth.value = entry?.contentRect.width ?? 0;
  });
});

const moreOptions = computed<DropdownOption[]>(() => [
  ...(compactPreferences.value
    ? [{
        key: 'theme',
        label: isDarkTheme.value ? t('home.nav.lightMode') : t('home.nav.darkMode'),
        icon: () => h(isDarkTheme.value ? IconSun : IconMoon, { size: 20 }),
      }]
    : []),
  {
    key: 'about',
    label: t('home.nav.aboutLabel'),
    icon: () => h(IconInfoCircle, { size: 20 }),
  },
  {
    key: 'github',
    label: t('home.nav.github'),
    icon: () => h(IconBrandGithub, { size: 20 }),
  },
  ...(showUiLibrary
    ? [{
        key: 'ui-library',
        label: t('home.uiLib'),
        icon: () => h(IconBrush, { size: 20 }),
      }]
    : []),
]);

function selectMore(key: string) {
  if (key === 'theme') {
    styleStore.toggleDark();
  }
  else if (key === 'about' || key === 'ui-library') {
    void router.push(key === 'about' ? '/about' : '/c-lib');
  }
  else if (key === 'github') {
    window.open(repositoryUrl, '_blank', 'noopener,noreferrer');
  }
}

function openSponsoring() {
  tracker.trackEvent({ eventName: 'Support button clicked' });
  window.open(sponsoringUrl, '_blank', 'noopener,noreferrer');
}
</script>

<template>
  <div ref="navbarActions" class="navbar-actions">
    <div class="navbar-group">
      <c-tooltip :tooltip="$t('home.nav.pluginMarketplace')" position="bottom">
        <c-button circle variant="text" to="/plugin-marketplace" :aria-label="$t('home.nav.pluginMarketplace')">
          <NIcon size="22" :component="IconPuzzle" />
        </c-button>
      </c-tooltip>
      <c-tooltip :tooltip="$t('home.nav.settings')" position="bottom">
        <c-button circle variant="text" to="/settings" :aria-label="$t('home.nav.settings')">
          <NIcon size="22" :component="IconSettings" />
        </c-button>
      </c-tooltip>
    </div>

    <div v-if="!compactPreferences" class="navbar-group navbar-preferences">
      <locale-selector />
      <c-tooltip :tooltip="isDarkTheme ? $t('home.nav.lightMode') : $t('home.nav.darkMode')" position="bottom">
        <c-button circle variant="text" :aria-label="$t('home.nav.mode')" @click="styleStore.toggleDark()">
          <NIcon size="22" :component="isDarkTheme ? IconSun : IconMoon" />
        </c-button>
      </c-tooltip>
    </div>

    <NDropdown
      v-model:show="moreOpen"
      trigger="click"
      placement="bottom-end"
      :options="moreOptions"
      :menu-props="() => ({ role: 'menu', 'aria-label': t('home.nav.more') })"
      :node-props="() => ({ role: 'menuitem' })"
      @select="selectMore"
    >
      <c-button
        circle
        variant="text"
        :aria-label="$t('home.nav.more')"
        :title="$t('home.nav.more')"
        aria-haspopup="menu"
        :aria-expanded="moreOpen"
        @keydown.down.prevent="moreOpen = true"
        @keydown.tab="moreOpen = false"
      >
        <NIcon size="22" :component="IconDots" />
      </c-button>
    </NDropdown>

    <c-tooltip class="navbar-sponsor-group" :tooltip="$t('home.buyMeACoffee')" position="bottom">
      <c-button
        class="navbar-sponsor"
        type="primary"
        :aria-label="$t('home.buyMeACoffee')"
        :title="$t('home.buyMeACoffee')"
        @click="openSponsoring"
      >
        <span class="navbar-sponsor-label">{{ $t('home.buyMeACoffee') }}</span>
        <NIcon size="18" :component="IconHeart" />
      </c-button>
    </c-tooltip>
  </div>
</template>

<style lang="less" scoped>
.navbar-actions,
.navbar-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.navbar-actions {
  flex: 0 0 auto;

  :deep(.c-button.circle) {
    width: 36px;
    height: 36px;
    border-radius: 8px;
  }

  :deep(.router-link-active) {
    color: v-bind('themeVars.primaryColor');
    background: v-bind('themeVars.buttonColor2');
  }
}

.navbar-sponsor {
  width: auto;
  min-width: 36px;
  height: 36px;
  gap: 6px;
  border-radius: 8px;

  @container navigation (max-width: 700px) {
    width: 36px;
    padding: 0;
  }
}

.navbar-sponsor-group {
  margin-left: 6px;
  padding-left: 10px;
  border-left: 1px solid v-bind('themeVars.borderColor');
}

.navbar-sponsor-label {
  white-space: nowrap;

  @container navigation (max-width: 700px) {
    display: none;
  }
}

@container navigation (max-width: 360px) {
  .navbar-actions,
  .navbar-group {
    gap: 0;
  }

  .navbar-sponsor-group {
    margin-left: 0;
    padding-left: 3px;
  }
}
</style>
