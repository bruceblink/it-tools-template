import { Mailbox } from '@vicons/tabler';
import { defineTool } from '../tool';

export const tool = defineTool({
  name: 'Outlook Safelink decoder',
  path: '/safelink-decoder',
  description: 'Decode Outlook SafeLink links and inspect their tracking parameters',
  keywords: ['outlook', 'safelink', 'decoder', 'microsoft', 'url', 'sdata', 'tracking'],
  component: () => import('./safelink-decoder.vue'),
  icon: Mailbox,
  createdAt: new Date('2024-03-11'),
});
