import { HttpRound } from '@vicons/material';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';

import { codesByCategories } from './http-status-codes.constants';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/http-status-codes',
  extensionOwned: true,
  categoryId: 'web',
  translationKey: 'http-status-codes',
  platforms: ['web', 'electron'],
  dataProcessing: 'local-data',
  offline: 'available',
  capabilities: [],
  name: translate('tools.http-status-codes.title'),
  path: '/http-status-codes',
  description: translate('tools.http-status-codes.description'),
  keywords: [
    'http',
    'status',
    'codes',
    ...codesByCategories.flatMap(({ codes }) => codes.flatMap(({ code, name }) => [String(code), name])),
  ],
  component: () => loadBuiltinToolComponent('http-status-codes/http-status-codes.vue'),
  icon: HttpRound,
  createdAt: new Date('2023-04-13'),
});
