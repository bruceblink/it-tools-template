// @vitest-environment jsdom
import { defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import MetaTagGenerator from './meta-tag-generator.vue';

const SelectStub = defineComponent({
  name: 'CSelect',
  props: {
    value: { type: String, default: '' },
    options: { type: Array, default: () => [] },
  },
  emits: ['update:value'],
  setup(props, { emit }) {
    return () => h(
      'select',
      {
        value: props.value,
        onChange: (event: Event) => emit('update:value', (event.target as HTMLSelectElement).value),
      },
      (props.options as Array<{ label: string; value: string }>).map(option =>
        h('option', { key: option.value, value: option.value }, option.label),
      ),
    );
  },
});

const InputStub = defineComponent({
  name: 'CInputText',
  props: { value: { type: String, default: '' } },
  emits: ['update:value'],
  setup(props, { emit }) {
    return () => h('input', {
      value: props.value,
      onInput: (event: Event) => emit('update:value', (event.target as HTMLInputElement).value),
    });
  },
});

const CopyableStub = defineComponent({
  name: 'TextareaCopyable',
  props: { value: { type: String, required: true } },
  setup(props) {
    return () => h('button', { 'data-test-id': 'copy-output', onClick: () => navigator.clipboard.writeText(props.value) }, props.value);
  },
});

function mountGenerator() {
  return mount(MetaTagGenerator, {
    global: {
      stubs: {
        CSelect: SelectStub,
        CInputText: InputStub,
        NInputGroup: defineComponent({ name: 'NInputGroup', template: '<div><slot /></div>' }),
        NInputGroupLabel: defineComponent({ name: 'NInputGroupLabel', template: '<label><slot /></label>' }),
        NDynamicInput: defineComponent({ name: 'NDynamicInput', template: '<div />' }),
        NFormItem: defineComponent({ name: 'NFormItem', template: '<div><slot /></div>' }),
        TextareaCopyable: CopyableStub,
      },
    },
  });
}

describe('meta tag generator component', () => {
  it('updates the selected type and keeps general metadata', async () => {
    const wrapper = mountGenerator();
    const pageType = wrapper.findAll('select')[0]!;
    await pageType.setValue('music.song');
    await wrapper.find('input[placeholder="The album this song is from..."]').setValue('Album before switching');
    await pageType.setValue('article');
    await nextTick();

    const output = wrapper.get('[data-test-id="copy-output"]').text();
    expect(output).toContain('<meta property="og:type" content="article" />');
    expect(output).not.toContain('Album before switching');
    expect(pageType.element.value).toBe('article');
  });

  it('passes the generated HTML to the copy control', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const wrapper = mountGenerator();

    const copyButton = wrapper.get('[data-test-id="copy-output"]');
    expect(copyButton.text()).toContain('<meta property="og:type" content="website" />');

    await copyButton.trigger('click');
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('content="website"'));
  });
});
