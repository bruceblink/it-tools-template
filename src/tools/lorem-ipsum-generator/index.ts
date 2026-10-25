import { AlignJustified } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/lorem-ipsum-generator',
  categoryId: 'text',
  translationKey: 'lorem-ipsum-generator',
  name: translate('tools.lorem-ipsum-generator.title'),
  path: '/lorem-ipsum-generator',
  description: translate('tools.lorem-ipsum-generator.description'),
  keywords: ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'placeholder', 'text', 'filler', 'random', 'generator'],
  component: () => loadBuiltinToolComponent('lorem-ipsum-generator/lorem-ipsum-generator.vue'),
  icon: AlignJustified,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
});
