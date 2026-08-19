import { defineModule, page } from '@ploykit/module-sdk';

export default defineModule({
  id: '__MODULE_ID__',
  name: '__MODULE_NAME__',
  version: '0.1.0',
  profile: 'app' as const,
  pages: [
    page({
      id: '__MODULE_ID__.home',
      area: 'dashboard',
      path: '/__MODULE_ID__',
      frame: 'workspace',
      component: './pages/AppPage.tsx',
      auth: 'auth',
    }),
  ],
  navigation: {
    location: 'dashboard.sidebar' as const,
    fallbackLabel: '__MODULE_NAME__',
    path: '/__MODULE_ID__',
    weight: 100,
  },
});
