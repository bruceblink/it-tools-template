import { Edit } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/html-wysiwyg-editor',
  categoryId: 'web',
  translationKey: 'html-wysiwyg-editor',
  name: translate('tools.html-wysiwyg-editor.title'),
  path: '/html-wysiwyg-editor',
  description: translate('tools.html-wysiwyg-editor.description'),
  keywords: ['html', 'wysiwyg', 'editor', 'p', 'ul', 'ol', 'converter', 'live'],
  component: () => loadBuiltinToolComponent('html-wysiwyg-editor/html-wysiwyg-editor.vue'),
  icon: Edit,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write', 'file.save'],
});
