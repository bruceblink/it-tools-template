import { Camera } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/camera-recorder',
  categoryId: 'images-and-videos',
  translationKey: 'camera-recorder',
  name: translate('tools.camera-recorder.title'),
  path: '/camera-recorder',
  description: translate('tools.camera-recorder.description'),
  keywords: ['camera', 'recoder'],
  component: () => import('./camera-recorder.vue'),
  icon: Camera,
  createdAt: new Date('2023-05-15'),
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['device.camera', 'file.save', 'runtime.info'],
});
