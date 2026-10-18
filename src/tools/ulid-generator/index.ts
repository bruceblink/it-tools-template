import { SortDescendingNumbers } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/ulid-generator',
  categoryId: 'crypto',
  translationKey: 'ulid-generator',
  name: translate('tools.ulid-generator.title'),
  path: '/ulid-generator',
  description: translate('tools.ulid-generator.description'),
  keywords: ['ulid', 'generator', 'random', 'id', 'alphanumeric', 'identity', 'token', 'string', 'identifier', 'unique'],
  component: () => import('./ulid-generator.vue'),
  icon: SortDescendingNumbers,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  createdAt: new Date('2023-09-11'),
});
