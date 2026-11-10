import { mount } from '@vue/test-utils';
import { defineComponent, h, markRaw } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { describe, expect, it } from 'vitest';
import CollapsibleToolMenu from './CollapsibleToolMenu.vue';

const icon = markRaw(defineComponent({ render: () => h('span', 'icon') }));

function createTools(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `builtin/${index}`,
    categoryId: 'development',
    category: 'Development',
    name: `Built in ${index}`,
    path: `/built-${index}`,
    translationKey: `built-${index}`,
    description: 'Built in tool',
    keywords: [],
    component: async () => ({}),
    icon,
    platforms: ['electron' as const],
    dataProcessing: 'memory-only' as const,
    offline: 'available' as const,
    capabilities: [],
    isNew: false,
  }));
}

function category(components: ReturnType<typeof createTools>) {
  return [{ id: 'development', name: 'Development', components }];
}

describe('CollapsibleToolMenu', () => {
  it('updates navigation when tools are added and removed asynchronously', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }],
    });
    const builtInTools = createTools(27);
    const pluginTool = {
      ...createTools(1)[0]!,
      id: 'external-v2/example/1.0.0/echo',
      name: 'Plugin tool',
      path: '/extensions/example/1.0.0/echo',
      translationKey: 'plugin-tool',
    };
    const wrapper = mount(CollapsibleToolMenu, {
      props: { toolsByCategory: category(builtInTools) },
      global: { plugins: [router] },
    });

    expect(wrapper.findAll('a[href^="/built-"]')).toHaveLength(27);
    expect(wrapper.find('a[href="/extensions/example/1.0.0/echo"]').exists()).toBe(false);

    await wrapper.setProps({ toolsByCategory: category([...builtInTools, pluginTool]) });
    await wrapper.vm.$nextTick();

    expect(wrapper.find('a[href="/extensions/example/1.0.0/echo"]').exists()).toBe(true);
    expect(wrapper.findAll('a[href^="/built-"]')).toHaveLength(27);

    await wrapper.setProps({ toolsByCategory: category(builtInTools) });
    await wrapper.vm.$nextTick();

    expect(wrapper.find('a[href="/extensions/example/1.0.0/echo"]').exists()).toBe(false);
    expect(wrapper.findAll('a[href^="/built-"]')).toHaveLength(27);
    wrapper.unmount();
  });
});
