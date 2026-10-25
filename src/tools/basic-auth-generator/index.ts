import { PasswordRound } from '@vicons/material';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/basic-auth-generator',
  categoryId: 'web',
  translationKey: 'basic-auth-generator',
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  name: translate('tools.basic-auth-generator.title'),
  path: '/basic-auth-generator',
  description: translate('tools.basic-auth-generator.description'),
  keywords: [
    'basic',
    'auth',
    'generator',
    'username',
    'password',
    'base64',
    'authentication',
    'header',
    'authorization',
  ],
  component: () => loadBuiltinToolComponent('basic-auth-generator/basic-auth-generator.vue'),
  icon: PasswordRound,
});
