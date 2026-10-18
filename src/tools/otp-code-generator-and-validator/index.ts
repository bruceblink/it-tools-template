import { DeviceMobile } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/otp-generator',
  categoryId: 'web',
  translationKey: 'otp-generator',
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  name: translate('tools.otp-generator.title'),
  path: '/otp-generator',
  description: translate('tools.otp-generator.description'),
  keywords: [
    'otp',
    'code',
    'generator',
    'validator',
    'one',
    'time',
    'password',
    'authentication',
    'MFA',
    'mobile',
    'device',
    'security',
    'TOTP',
    'Time',
    'HMAC',
  ],
  component: () => import('./otp-code-generator-and-validator.vue'),
  icon: DeviceMobile,
});
