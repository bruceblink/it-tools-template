import { Tags } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/og-meta-generator',
  categoryId: 'web',
  translationKey: 'og-meta-generator',
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  name: translate('tools.og-meta-generator.title'),
  path: '/og-meta-generator',
  description: translate('tools.og-meta-generator.description'),
  keywords: [
    'meta',
    'tag',
    'generator',
    'social',
    'title',
    'description',
    'image',
    'share',
    'online',
    'website',
    'open',
    'graph',
    'og',
  ],
  component: () => import('./meta-tag-generator.vue'),
  icon: Tags,
});
