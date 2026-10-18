import { SpeedFilled } from '@vicons/material';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/benchmark-builder',
  categoryId: 'measurement',
  translationKey: 'benchmark-builder',
  name: translate('tools.benchmark-builder.title'),
  path: '/benchmark-builder',
  description: translate('tools.benchmark-builder.description'),
  keywords: ['benchmark', 'builder', 'execution', 'duration', 'mean', 'variance'],
  component: () => import('./benchmark-builder.vue'),
  icon: SpeedFilled,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  createdAt: new Date('2023-04-05'),
});
