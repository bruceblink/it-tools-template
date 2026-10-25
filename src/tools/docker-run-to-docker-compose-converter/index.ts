import { BrandDocker } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/docker-run-to-docker-compose-converter',
  categoryId: 'development',
  translationKey: 'docker-run-to-docker-compose-converter',
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write', 'file.save'],
  name: translate('tools.docker-run-to-docker-compose-converter.title'),
  path: '/docker-run-to-docker-compose-converter',
  description: translate('tools.docker-run-to-docker-compose-converter.description'),
  keywords: ['docker', 'run', 'compose', 'yaml', 'yml', 'convert', 'deamon'],
  component: () => loadBuiltinToolComponent('docker-run-to-docker-compose-converter/docker-run-to-docker-compose-converter.vue'),
  icon: BrandDocker,
});
