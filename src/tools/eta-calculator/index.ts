import { Hourglass } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/eta-calculator',
  categoryId: 'math',
  translationKey: 'eta-calculator',
  name: translate('tools.eta-calculator.title'),
  path: '/eta-calculator',
  description: translate('tools.eta-calculator.description'),
  keywords: ['eta', 'calculator', 'estimated', 'time', 'arrival', 'average'],
  component: () => loadBuiltinToolComponent('eta-calculator/eta-calculator.vue'),
  icon: Hourglass,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: [],
});
