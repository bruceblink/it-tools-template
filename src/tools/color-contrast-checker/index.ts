import { Contrast2 } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/color-contrast-checker',
  categoryId: 'converter',
  translationKey: 'color-contrast-checker',
  name: translate('tools.color-contrast-checker.title'),
  path: '/color-contrast-checker',
  description: translate('tools.color-contrast-checker.description'),
  keywords: ['color', 'contrast', 'accessibility', 'wcag', 'a11y', 'foreground', 'background'],
  component: () => import('./color-contrast-checker.vue'),
  icon: Contrast2,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  createdAt: new Date('2026-07-03'),
});
