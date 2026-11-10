import { flushPromises, mount } from '@vue/test-utils';
import { createHead, renderDOMHead } from '@unhead/vue/client';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory, createRouter } from 'vue-router';
import { defineComponent, h, nextTick, type PropType } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';
import ToolLayout from './tool.layout.vue';
import { externalPluginV2Registry } from '@/tools/external-plugin-v2-registry';
import { projectExternalPluginV2Manifest } from '@/tools/external-plugin-v2-tools';
import { validateExternalPluginV2Manifest } from '@/shared/external-plugin-v2';

const pluginId = 'org.example.layout-demo';
const toolPath = `/extensions/${pluginId}/1.0.0/echo`;
const FavoriteStub = defineComponent({
  props: { tool: { type: Object as PropType<{ name: string; path: string }>, required: true } },
  setup: props => () => h('button', { 'data-favorite-name': props.tool.name }),
});

function createProjection() {
  const manifest = validateExternalPluginV2Manifest({
    formatVersion: 2,
    id: pluginId,
    name: 'Layout demo',
    version: '1.0.0',
    apiVersion: { minInclusive: '2.0.0', maxExclusive: '3.0.0' },
    requestedCapabilities: [],
    activationEvents: [`onTool:${pluginId}/echo`, `onCommand:${pluginId}/run`],
    contributions: {
      tools: [{
        id: `${pluginId}/echo`,
        title: 'Echo tool',
        description: 'Return the supplied value.',
        keywords: ['echo'],
        categoryId: 'development',
        dataProcessing: 'memory-only',
        offline: 'available',
        capabilities: [],
        inputs: [{ kind: 'text', id: 'value', label: 'Value' }],
        output: { kind: 'text' },
      }],
      commands: [{
        id: `${pluginId}/run`,
        title: 'Run echo tool',
        description: 'Open the echo tool.',
        keywords: ['echo'],
        toolId: `${pluginId}/echo`,
      }],
    },
  });
  const stub = defineComponent({ render: () => null });
  return projectExternalPluginV2Manifest(manifest, {
    component: async () => stub,
    icon: stub,
  });
}

async function flushHead(head: ReturnType<typeof createHead>): Promise<void> {
  await nextTick();
  await flushPromises();
  await renderDOMHead(head);
}

afterEach(() => externalPluginV2Registry.clear());

describe('tool layout plugin metadata', () => {
  it('reacts to v2 registration without relying on nested route meta changes', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{
        path: '/extensions/:pluginId/:version/:toolId',
        component: ToolLayout,
        meta: {
          name: 'External plugin tool',
          description: 'Run an installed plugin tool inside the IT Tools workspace.',
          keywords: ['plugin', 'external', 'desktop'],
          translationKey: 'external-plugin-tool',
          contentWidth: 'wide',
        },
      }],
    });
    await router.push(toolPath);
    await router.isReady();
    const head = createHead();
    const wrapper = mount(ToolLayout, {
      slots: { default: '<section>Tool body</section>' },
      global: {
        plugins: [
          router,
          head,
          createI18n({ legacy: false, locale: 'en', messages: { en: {} } }),
        ],
        stubs: {
          BaseLayout: defineComponent({ setup: (_, { slots }) => () => h('main', slots.default?.()) }),
          FavoriteButton: FavoriteStub,
          'n-h1': defineComponent({ setup: (_, { slots }) => () => h('h1', slots.default?.()) }),
        },
      },
    });
    await flushHead(head);

    expect(wrapper.get('h1').text()).toBe('External plugin tool');
    expect(wrapper.get('.description').text()).toBe('Run an installed plugin tool inside the IT Tools workspace.');
    expect(wrapper.get('.tool-layout').classes()).toContain('tool-layout--wide');
    expect(wrapper.get('.tool-content').classes()).toContain('tool-content--wide');
    expect(wrapper.get('[data-favorite-name]').attributes('data-favorite-name')).toBe('External plugin tool');

    externalPluginV2Registry.register(createProjection(), async () => ({ kind: 'text', value: '' }));
    await flushHead(head);

    expect(router.currentRoute.value.meta.name).toBe('External plugin tool');
    expect(wrapper.get('h1').text()).toBe('Echo tool');
    expect(wrapper.get('.description').text()).toBe('Return the supplied value.');
    expect(wrapper.get('.tool-layout').classes()).not.toContain('tool-layout--wide');
    expect(wrapper.get('.tool-content').classes()).not.toContain('tool-content--wide');
    expect(wrapper.get('[data-favorite-name]').attributes('data-favorite-name')).toBe('Echo tool');
    expect(document.head.querySelector('title')?.textContent).toBe('Echo tool - IT Tools');
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute('content'))
      .toBe('Return the supplied value.');

    externalPluginV2Registry.clear();
    await flushHead(head);

    expect(wrapper.get('h1').text()).toBe('External plugin tool');
    expect(wrapper.get('.description').text()).toBe('Run an installed plugin tool inside the IT Tools workspace.');
    expect(wrapper.get('.tool-layout').classes()).toContain('tool-layout--wide');
    expect(document.title).toBe('External plugin tool - IT Tools');
    wrapper.unmount();
  });
});
