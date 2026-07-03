import { ShieldLock } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  name: translate('tools.sri-hash-generator.title'),
  path: '/sri-hash-generator',
  description: translate('tools.sri-hash-generator.description'),
  keywords: ['sri', 'subresource integrity', 'hash', 'cdn', 'script', 'stylesheet', 'sha384', 'sha512', 'summary'],
  component: () => import('./sri-hash-generator.vue'),
  icon: ShieldLock,
  createdAt: new Date('2026-07-04'),
});
