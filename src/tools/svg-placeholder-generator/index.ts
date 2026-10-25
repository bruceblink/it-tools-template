import { ImageOutlined } from '@vicons/material';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/svg-placeholder-generator',
  categoryId: 'images-and-videos',
  translationKey: 'svg-placeholder-generator',
  name: translate('tools.svg-placeholder-generator.title'),
  path: '/svg-placeholder-generator',
  description: translate('tools.svg-placeholder-generator.description'),
  keywords: ['svg', 'placeholder', 'generator', 'image', 'size', 'mockup'],
  component: () => loadBuiltinToolComponent('svg-placeholder-generator/svg-placeholder-generator.vue'),
  icon: ImageOutlined,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write', 'file.save'],
});
