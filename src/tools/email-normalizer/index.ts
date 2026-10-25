import { Mail } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/email-normalizer',
  categoryId: 'development',
  translationKey: 'email-normalizer',
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  name: translate('tools.email-normalizer.title'),
  path: '/email-normalizer',
  description: translate('tools.email-normalizer.description'),
  keywords: ['email', 'normalizer'],
  component: () => loadBuiltinToolComponent('email-normalizer/email-normalizer.vue'),
  icon: Mail,
  createdAt: new Date('2024-08-15'),
});
