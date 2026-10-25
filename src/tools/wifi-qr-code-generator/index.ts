import { Qrcode } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/wifi-qrcode-generator',
  categoryId: 'images-and-videos',
  translationKey: 'wifi-qrcode-generator',
  name: translate('tools.wifi-qrcode-generator.title'),
  path: '/wifi-qrcode-generator',
  description: translate('tools.wifi-qrcode-generator.description'),
  keywords: ['qr', 'code', 'generator', 'square', 'color', 'link', 'low', 'medium', 'quartile', 'high', 'transparent', 'wifi'],
  component: () => loadBuiltinToolComponent('wifi-qr-code-generator/wifi-qr-code-generator.vue'),
  icon: Qrcode,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['file.save'],
  createdAt: new Date('2023-09-06'),
});
