import { Keyboard } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/keycode-info',
  categoryId: 'web',
  translationKey: 'keycode-info',
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: [],
  name: translate('tools.keycode-info.title'),
  path: '/keycode-info',
  description: translate('tools.keycode-info.description'),
  keywords: [
    'keycode',
    'info',
    'code',
    'javascript',
    'event',
    'keycodes',
    'which',
    'keyboard',
    'press',
    'modifier',
    'alt',
    'ctrl',
    'meta',
    'shift',
  ],
  component: () => loadBuiltinToolComponent('keycode-info/keycode-info.vue'),
  icon: Keyboard,
});
