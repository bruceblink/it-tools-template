import { AbcRound } from '@vicons/material';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/slugify-string',
  categoryId: 'web',
  translationKey: 'slugify-string',
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  name: translate('tools.slugify-string.title'),
  path: '/slugify-string',
  description: translate('tools.slugify-string.description'),
  keywords: ['slugify', 'string', 'escape', 'emoji', 'special', 'character', 'space', 'trim'],
  component: () => import('./slugify-string.vue'),
  icon: AbcRound,
});
