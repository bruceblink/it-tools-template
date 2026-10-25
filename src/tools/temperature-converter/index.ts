import { Temperature } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/temperature-converter',
  categoryId: 'measurement',
  translationKey: 'temperature-converter',
  name: translate('tools.temperature-converter.title'),
  path: '/temperature-converter',
  description: translate('tools.temperature-converter.description'),
  keywords: [
    'temperature',
    'converter',
    'degree',
    'Kelvin',
    'Celsius',
    'Fahrenheit',
    'Rankine',
    'Delisle',
    'Newton',
    'Réaumur',
    'Rømer',
  ],
  component: () => loadBuiltinToolComponent('temperature-converter/temperature-converter.vue'),
  icon: Temperature,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: [],
});
