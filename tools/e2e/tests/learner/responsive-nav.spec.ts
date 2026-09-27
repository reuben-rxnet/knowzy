import { describeResponsiveNav } from '../support/responsive-nav';

describeResponsiveNav({
  navName: 'Learning sections',
  start: '/',
  target: { path: '/help', label: 'Help & Support' },
});
