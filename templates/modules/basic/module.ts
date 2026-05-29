import { defineModule } from '@ploykit/module-sdk';

export default defineModule({
  id: '__MODULE_ID__',
  name: '__MODULE_NAME__',
  version: '0.1.0',
  routes: {
    dashboard: [
      {
        path: '/__MODULE_ID__',
        component: './pages/HomePage',
        auth: 'auth',
      },
    ],
    api: [
      {
        path: '/hello',
        handler: './api/hello',
        methods: ['GET'],
        auth: 'auth',
      },
    ],
  },
  actions: {
    ping: {
      handler: './actions/ping',
      auth: 'auth',
    },
  },
});
