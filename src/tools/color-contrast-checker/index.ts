import { Contrast2 } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  name: translate('tools.color-contrast-checker.title'),
  path: '/color-contrast-checker',
  description: translate('tools.color-contrast-checker.description'),
  keywords: ['color', 'contrast', 'accessibility', 'wcag', 'a11y', 'foreground', 'background'],
  component: () => import('./color-contrast-checker.vue'),
  icon: Contrast2,
  createdAt: new Date('2026-07-03'),
});
