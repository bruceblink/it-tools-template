import { Mailbox } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/safelink-decoder',
  categoryId: 'web',
  translationKey: 'safelink-decoder',
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  name: translate('tools.safelink-decoder.title'),
  path: '/safelink-decoder',
  description: translate('tools.safelink-decoder.description'),
  keywords: ['outlook', 'safelink', 'decoder', 'microsoft', 'url', 'sdata', 'tracking', 'target', 'host', 'https'],
  component: () => loadBuiltinToolComponent('safelink-decoder/safelink-decoder.vue'),
  icon: Mailbox,
  createdAt: new Date('2024-03-11'),
});
