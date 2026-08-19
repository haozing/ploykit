import { action, api, defineModule, page, schema, stringField } from '@ploykit/module-sdk';

const toolInputSchema = schema({
  name: 'ToolInput',
  fields: {
    text: stringField({ required: true }),
  },
});

export default defineModule({
  id: '__MODULE_ID__',
  name: '__MODULE_NAME__',
  version: '0.1.0',
  pages: [
    page({
      id: '__MODULE_ID__.tool',
      area: 'dashboard',
      path: '/__MODULE_ID__',
      frame: 'workspace',
      component: './pages/ToolPage.tsx',
      auth: 'auth',
    }),
  ],
  actions: {
    runTool: action({
      input: toolInputSchema,
      output: toolInputSchema,
      handler: './actions/run-tool.ts',
      sideEffect: 'none',
      auth: 'auth',
    }),
  },
  apis: [
    api({
      id: '__MODULE_ID__.run',
      path: '/__MODULE_ID__/run',
      methods: ['POST'],
      input: toolInputSchema,
      output: toolInputSchema,
      handler: './api/run.ts',
      auth: 'auth',
    }),
  ],
  navigation: {
    location: 'dashboard.sidebar',
    fallbackLabel: '__MODULE_NAME__',
    path: '/__MODULE_ID__',
    weight: 100,
  },
});
