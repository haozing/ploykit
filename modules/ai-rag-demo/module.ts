import { defineModule, Permission } from '@ploykit/module-sdk';

export default defineModule({
  id: 'ai-rag-demo',
  name: 'AI RAG Demo',
  contractVersion: 1,
  version: '0.1.0',
  description:
    'AI/RAG demo covering source indexing, context-pack query, AI generation, metering charge and credit guard metadata.',
  permissions: [
    Permission.AiGenerate,
    Permission.AiEmbed,
    Permission.RagRead,
    Permission.RagWrite,
    Permission.FilesRead,
    Permission.FilesWrite,
    Permission.MeteringWrite,
    Permission.CreditsConsume,
  ],
  routes: {
    dashboard: [
      {
        path: '/ai-rag-demo',
        component: './pages/AiRagPage',
        auth: 'auth',
        commercial: {
          credits: { amount: 1 },
        },
      },
    ],
    api: [
      {
        path: '/ai-rag-demo/ask',
        handler: './api/ask',
        methods: ['POST'],
        auth: 'auth',
        commercial: {
          credits: { amount: 1 },
        },
      },
    ],
  },
  actions: {
    ask: {
      handler: './actions/ask',
      auth: 'auth',
      commercial: {
        credits: { amount: 1 },
      },
    },
  },
  navigation: {
    location: 'dashboard.sidebar',
    fallbackLabel: 'AI/RAG Demo',
    path: '/ai-rag-demo',
    weight: 70,
    requires: {
      entitlements: ['ploykit.demo_modules'],
    },
  },
});
