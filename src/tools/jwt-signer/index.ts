import { Key } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  name: translate('tools.jwt-signer.title'),
  path: '/jwt-signer',
  description: translate('tools.jwt-signer.description'),
  keywords: ['jwt', 'json web token', 'sign', 'verify', 'signature', 'hmac', 'HS256', 'HS384', 'HS512'],
  component: () => import('./jwt-signer.vue'),
  icon: Key,
  createdAt: new Date('2026-07-01'),
});
