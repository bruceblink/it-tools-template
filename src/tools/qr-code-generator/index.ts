import { Qrcode } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/qrcode-generator',
  categoryId: 'images-and-videos',
  translationKey: 'qrcode-generator',
  name: translate('tools.qrcode-generator.title'),
  path: '/qrcode-generator',
  description: translate('tools.qrcode-generator.description'),
  keywords: ['qr', 'code', 'generator', 'square', 'color', 'link', 'low', 'medium', 'quartile', 'high', 'transparent'],
  component: () => loadBuiltinToolComponent('qr-code-generator/qr-code-generator.vue'),
  icon: Qrcode,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['file.save'],
});
