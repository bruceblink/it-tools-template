<script setup lang="ts">
import { IconDragDrop, IconHeart } from '@tabler/icons-vue';
import { useHead } from '@unhead/vue';
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue';
import ColoredCard from '../components/ColoredCard.vue';
import ToolCard from '../components/ToolCard.vue';
import { useToolStore } from '@/tools/tools.store';
import { config } from '@/config';

const toolStore = useToolStore();
const Draggable = defineAsyncComponent(() => import('vuedraggable'));

useHead({ title: 'IT Tools - Handy online tools for developers' });
const { t } = useI18n();

const favoriteTools = computed(() => toolStore.favoriteTools);
const repositoryUrl = config.app.repositoryUrl;
const toolCardHoverEnabled = ref(false);
const homeGridEntering = ref(false);
const visibleToolCount = ref(24);
const visibleTools = computed(() => toolStore.tools.slice(0, visibleToolCount.value));

let revealTimer: number | undefined;

function scheduleMoreTools(delay = 500) {
  if (visibleToolCount.value >= toolStore.tools.length || revealTimer !== undefined) {
    return;
  }

  const reveal = () => {
    revealTimer = undefined;
    visibleToolCount.value = Math.min(visibleToolCount.value + 24, toolStore.tools.length);
  };
  revealTimer = window.setTimeout(reveal, delay);
}

function revealToolsAfterScroll() {
  scheduleMoreTools(100);
}

function startHomeGridTransition() {
  homeGridEntering.value = true;
}

function finishHomeGridTransition() {
  homeGridEntering.value = false;
}

// Wait for movement over a tool card so pointer motion from route navigation does not enable stale hover styling.
function enableToolCardHover(event: PointerEvent) {
  if (homeGridEntering.value || event.pointerType !== 'mouse' || (event.movementX === 0 && event.movementY === 0)) {
    return;
  }

  if (!(event.target instanceof Element) || !event.target.closest('.grid-wrapper .decoration-none')) {
    return;
  }

  toolCardHoverEnabled.value = true;
  window.removeEventListener('pointermove', enableToolCardHover);
}

onMounted(() => {
  window.addEventListener('pointermove', enableToolCardHover, { passive: true });
  window.addEventListener('scroll', revealToolsAfterScroll, { passive: true });
});

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', enableToolCardHover);
  window.removeEventListener('scroll', revealToolsAfterScroll);
  if (revealTimer !== undefined) {
    window.clearTimeout(revealTimer);
  }
});

// Update favorite tools order when drag is finished
function onUpdateFavoriteTools() {
  toolStore.updateFavoriteTools(favoriteTools.value); // Update the store with the new order
}
</script>

<template>
  <div>
    <Transition
      name="home-grid"
      appear
      @before-enter="startHomeGridTransition"
      @after-enter="finishHomeGridTransition"
      @enter-cancelled="finishHomeGridTransition"
    >
      <div class="grid-wrapper home-grid">
        <div class="grid grid-cols-1 gap-12px lg:grid-cols-3 md:grid-cols-3 sm:grid-cols-2 xl:grid-cols-4">
          <ColoredCard v-if="config.showBanner" :title="$t('home.follow.title')" :icon="IconHeart">
            {{ $t('home.follow.p1') }}
            <a :href="`${repositoryUrl}`" rel="noopener" target="_blank" :aria-label="$t('home.follow.githubRepository')">GitHub</a>.
            {{ $t('home.follow.thankYou') }}
            <n-icon :component="IconHeart" />
          </ColoredCard>
        </div>

        <transition name="height">
          <div v-if="toolStore.favoriteTools.length > 0">
            <h3 class="mb-5px mt-25px text-neutral-400 font-500">
              {{ $t('home.categories.favoriteTools') }}
              <c-tooltip :tooltip="$t('home.categories.favoritesDndToolTip')">
                <n-icon :component="IconDragDrop" size="18" />
              </c-tooltip>
            </h3>
            <Draggable
              :list="favoriteTools"
              class="grid grid-cols-1 gap-12px lg:grid-cols-3 md:grid-cols-3 sm:grid-cols-2 xl:grid-cols-4"
              ghost-class="ghost-favorites-draggable"
              item-key="path"
              @end="onUpdateFavoriteTools"
            >
              <template #item="{ element: tool }">
                <ToolCard :tool="tool" :hover-enabled="toolCardHoverEnabled" />
              </template>
            </Draggable>
          </div>
        </transition>

        <div v-if="toolStore.newTools.length > 0">
          <h3 class="mb-5px mt-25px text-neutral-400 font-500">
            {{ t('home.categories.newestTools') }}
          </h3>
          <div class="grid grid-cols-1 gap-12px lg:grid-cols-3 md:grid-cols-3 sm:grid-cols-2 xl:grid-cols-4">
            <ToolCard v-for="tool in toolStore.newTools" :key="tool.path" :tool="tool" :hover-enabled="toolCardHoverEnabled" />
          </div>
        </div>

        <h3 class="mb-5px mt-25px text-neutral-400 font-500">
          {{ $t('home.categories.allTools') }}
        </h3>
        <div class="grid grid-cols-1 gap-12px lg:grid-cols-3 md:grid-cols-3 sm:grid-cols-2 xl:grid-cols-4">
          <ToolCard v-for="tool in visibleTools" :key="tool.path" :tool="tool" :hover-enabled="toolCardHoverEnabled" />
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped lang="less">
.height-enter-active,
.height-leave-active {
  transition: all 0.5s ease-in-out;
  overflow: hidden;
  max-height: 500px;
}

.height-enter-from,
.height-leave-to {
  max-height: 42px;
  overflow: hidden;
  opacity: 0;
  margin-bottom: 0;
}

.ghost-favorites-draggable {
  opacity: 0.4;
  background-color: #ccc;
  border: 2px dashed #666;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.2);
  transform: scale(1.1);
  animation: ghost-favorites-draggable-animation 0.2s ease-out;
}

.home-grid {
  transition: opacity 180ms ease-out, transform 180ms ease-out;
}

.home-grid-enter-from,
.home-grid-appear-from {
  opacity: 0;
  transform: translateY(6px);
}

@media (prefers-reduced-motion: reduce) {
  .home-grid {
    transition: none;
  }
}

@keyframes ghost-favorites-draggable-animation {
  0% {
    opacity: 0;
    transform: scale(0.9);
  }
  100% {
    opacity: 0.4;
    transform: scale(1);
  }
}
</style>
