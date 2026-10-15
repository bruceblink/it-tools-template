import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import CMarkdown from './c-markdown.vue';

describe('c-markdown', () => {
  it('sanitizes raw HTML and unsafe links while keeping safe new-tab links protected', () => {
    const wrapper = mount(CMarkdown, {
      props: {
        markdown:
          '<script>alert(1)</script><img src="x" onerror="alert(2)">' +
          '\n\n[bad](javascript:alert(3)) [safe](https://example.test)',
      },
    });

    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.find('[onerror]').exists()).toBe(false);
    expect(wrapper.find('a[href^="javascript:"]').exists()).toBe(false);
    expect(wrapper.find('a[href="https://example.test"]').attributes()).toMatchObject({
      target: '_blank',
      rel: 'noopener noreferrer',
    });

    wrapper.unmount();
  });
});
