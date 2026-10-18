import { PasswordRound } from '@vicons/material';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/basic-auth-parser',
  categoryId: 'web',
  translationKey: 'basic-auth-parser',
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  name: translate('tools.basic-auth-parser.title'),
  path: '/basic-auth-parser',
  description: translate('tools.basic-auth-parser.description'),
  keywords: ['basic', 'auth', 'parser', 'username', 'password', 'base64', 'authentication', 'authorization', 'security', 'weak password'],
  component: () => import('./basic-auth-parser.vue'),
  icon: PasswordRound,
  createdAt: new Date('2026-07-04'),
});
