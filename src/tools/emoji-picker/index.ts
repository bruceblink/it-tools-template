import { MoodSmile } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/emoji-picker',
  categoryId: 'text',
  translationKey: 'emoji-picker',
  name: translate('tools.emoji-picker.title'),
  path: '/emoji-picker',
  description: translate('tools.emoji-picker.description'),
  keywords: ['emoji', 'picker', 'unicode', 'copy', 'paste'],
  component: () => loadBuiltinToolComponent('emoji-picker/emoji-picker.vue'),
  icon: MoodSmile,
  platforms: ['web', 'electron'],
  dataProcessing: 'local-data',
  offline: 'available',
  capabilities: ['clipboard.write'],
  createdAt: new Date('2023-08-07'),
});
