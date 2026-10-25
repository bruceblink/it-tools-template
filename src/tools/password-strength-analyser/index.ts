import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';
import PasswordIcon from '~icons/mdi/form-textbox-password';

export const tool = defineTool({
  id: 'builtin/password-strength-analyser',
  categoryId: 'crypto',
  translationKey: 'password-strength-analyser',
  name: translate('tools.password-strength-analyser.title'),
  path: '/password-strength-analyser',
  description: translate('tools.password-strength-analyser.description'),
  keywords: ['password', 'strength', 'analyser', 'and', 'crack', 'time', 'estimation', 'brute', 'force', 'attack', 'entropy', 'cracking', 'hash', 'hashing', 'algorithm', 'algorithms', 'md5', 'sha1', 'sha256', 'sha512', 'bcrypt', 'scrypt', 'argon2', 'argon2id', 'argon2i', 'argon2d'],
  component: () => loadBuiltinToolComponent('password-strength-analyser/password-strength-analyser.vue'),
  icon: PasswordIcon,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: [],
  createdAt: new Date('2023-06-24'),
});
