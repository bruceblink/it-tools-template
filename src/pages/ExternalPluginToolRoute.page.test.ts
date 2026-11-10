import { flushPromises, shallowMount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory, createRouter } from 'vue-router';
import { defineComponent } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';
import ExternalPluginToolRoute from './ExternalPluginToolRoute.page.vue';
import ExternalPluginV2ToolPage from './ExternalPluginV2Tool.page.vue';
import PluginToolWorkbench from './PluginToolWorkbench.page.vue';
import { projectExternalPluginV2Manifest } from '@/tools/external-plugin-v2-tools';
import { externalPluginV2Registry } from '@/tools/external-plugin-v2-registry';
import { validateExternalPluginV2Manifest } from '@/shared/external-plugin-v2';

const pluginId = 'org.example.deep-link';
const toolPath = `/extensions/${pluginId}/1.0.0/echo`;

function createProjection(title = 'Echo tool') {
  const manifest = validateExternalPluginV2Manifest({
    formatVersion: 2,
    id: pluginId,
    name: 'Deep link demo',
    version: '1.0.0',
    apiVersion: { minInclusive: '2.0.0', maxExclusive: '3.0.0' },
    requestedCapabilities: [],
    activationEvents: [`onTool:${pluginId}/echo`, `onCommand:${pluginId}/run`],
    contributions: {
      tools: [{
        id: `${pluginId}/echo`,
        title,
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

afterEach(() => {
  externalPluginV2Registry.clear();
  externalPluginV2Registry.initialized.value = false;
});

describe('ExternalPluginToolRoute', () => {
  it('updates the workbench when the registration changes without changing its route', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/extensions/:pluginId/:version/:toolId', component: ExternalPluginV2ToolPage }],
    });
    await router.push(toolPath);
    await router.isReady();
    externalPluginV2Registry.register(createProjection(), async () => ({ kind: 'text', value: '' }));
    const wrapper = shallowMount(ExternalPluginV2ToolPage, { global: { plugins: [router] } });
    expect(wrapper.getComponent(PluginToolWorkbench).props('tool').title).toBe('Echo tool');

    externalPluginV2Registry.register(createProjection('Updated echo tool'), async () => ({ kind: 'text', value: '' }));
    await flushPromises();
    expect(wrapper.getComponent(PluginToolWorkbench).props('tool').title).toBe('Updated echo tool');
    wrapper.unmount();
  });

  it('updates legacy route metadata when the v2 registry loads after a deep link', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{
        path: '/extensions/:pluginId/:version/:toolId',
        name: 'external-plugin-tool',
        component: ExternalPluginToolRoute,
        meta: {
          isTool: true,
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

    const wrapper = shallowMount(ExternalPluginToolRoute, {
      global: {
        plugins: [
          router,
          createI18n({ legacy: false, locale: 'en', messages: { en: {} } }),
        ],
      },
    });

    expect(router.currentRoute.value.meta.name).toBe('External plugin tool');
    expect(wrapper.findComponent(ExternalPluginV2ToolPage).exists()).toBe(false);
    expect(wrapper.get('[role="status"]').text()).toBe('Loading plugin tools…');

    externalPluginV2Registry.register(createProjection(), async () => ({ kind: 'text', value: '' }));
    externalPluginV2Registry.initialized.value = true;
    await flushPromises();

    expect(router.currentRoute.value.meta).toMatchObject({
      name: 'Echo tool',
      description: 'Return the supplied value.',
      keywords: ['echo', 'plugin', 'extension'],
      contentWidth: undefined,
    });
    expect(router.currentRoute.value.meta.translationKey).toMatch(/^external-plugin-/);
    expect(wrapper.findComponent(ExternalPluginV2ToolPage).exists()).toBe(true);

    externalPluginV2Registry.clear();
    await flushPromises();

    expect(router.currentRoute.value.meta).toMatchObject({
      name: 'External plugin tool',
      description: 'Run an installed plugin tool inside the IT Tools workspace.',
      keywords: ['plugin', 'external', 'desktop'],
      translationKey: 'external-plugin-tool',
      contentWidth: 'wide',
    });
    expect(wrapper.findComponent(ExternalPluginV2ToolPage).exists()).toBe(false);
    wrapper.unmount();
  });
});
