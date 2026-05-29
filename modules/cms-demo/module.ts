import { defineModule, jsonb, Permission, table, text, timestamp } from '@ploykit/module-sdk';

export default defineModule({
  id: 'cms-demo',
  name: 'CMS Demo',
  contractVersion: 1,
  version: '0.1.0',
  description:
    'Product-grade CMS module sample with posts, categories, SEO metadata and a publish workflow.',
  permissions: [
    Permission.DataTableRead,
    Permission.DataTableWrite,
    Permission.FilesRead,
    Permission.FilesWrite,
    Permission.AuditWrite,
    Permission.EventsEmit,
    Permission.NotificationsSend,
    Permission.CacheRevalidate,
    Permission.SurfaceContribute,
    Permission.UsageWrite,
  ],
  data: {
    version: 1,
    tables: {
      posts: table({
        scope: 'product',
        columns: {
          title: text().notNull(),
          slug: text().notNull(),
          excerpt: text().nullable(),
          body: text().notNull(),
          status: text().notNull().default('draft'),
          category_slug: text().nullable(),
          seo_title: text().nullable(),
          seo_description: text().nullable(),
          published_at: timestamp().nullable(),
          metadata: jsonb().notNull().default({ source: 'cms-demo' }),
        },
        unique: [['slug']],
        indexes: [['status'], ['category_slug'], ['published_at']],
      }),
      categories: table({
        scope: 'product',
        columns: {
          name: text().notNull(),
          slug: text().notNull(),
          status: text().notNull().default('active'),
          metadata: jsonb().notNull().default({ source: 'cms-demo' }),
        },
        unique: [['slug']],
        indexes: [['status']],
      }),
      notes: table({
        scope: 'workspace',
        columns: {
          title: text().notNull(),
          body: text().nullable(),
          status: text().notNull().default('draft'),
          attachment_file_id: text().nullable(),
          metadata: jsonb().notNull().default({ source: 'cms-demo' }),
          published_at: timestamp().nullable(),
        },
        indexes: [['status'], ['published_at'], ['attachment_file_id']],
      }),
    },
    migrations: {
      mode: 'generated',
      dir: './migrations',
    },
  },
  routes: {
    site: [
      {
        path: '/cms-demo',
        component: './pages/PublicCmsPage',
        loader: './loaders/public-posts',
        metadata: './loaders/cms-metadata',
        publicAliases: ['/cms', '/blog'],
        auth: 'public',
        cache: {
          strategy: 'public',
          revalidateSeconds: 120,
          tags: ['cms-demo', 'cms-demo-posts'],
        },
      },
    ],
    dashboard: [
      {
        path: '/cms-demo',
        component: './pages/CmsStudioPage',
        loader: './loaders/studio',
        auth: 'auth',
        permissions: [Permission.DataTableRead],
      },
      {
        path: '/cms-demo/notes',
        component: './pages/NotesPage',
        loader: './loaders/notes',
        auth: 'auth',
        permissions: [Permission.DataTableRead],
      },
    ],
    api: [
      {
        path: '/cms-demo/posts',
        handler: './api/posts',
        methods: ['GET', 'POST'],
        auth: 'auth',
        permissions: [Permission.DataTableRead, Permission.DataTableWrite],
      },
      {
        path: '/cms-demo/notes',
        handler: './api/notes',
        methods: ['GET', 'POST'],
        auth: 'auth',
        permissions: [Permission.DataTableRead, Permission.DataTableWrite],
      },
    ],
  },
  actions: {
    publishPost: {
      handler: './actions/publish-post',
      auth: 'auth',
      sideEffect: 'write',
      permissions: [
        Permission.DataTableRead,
        Permission.DataTableWrite,
        Permission.AuditWrite,
        Permission.EventsEmit,
        Permission.NotificationsSend,
      ],
    },
    createNote: {
      handler: './actions/create-note',
      auth: 'auth',
      sideEffect: 'write',
      permissions: [Permission.DataTableWrite, Permission.FilesWrite],
    },
  },
  events: {
    publishes: ['cms.post.published'],
  },
  surfaces: {
    'admin.modules:panels': {
      mode: 'panel',
      component: './surfaces/AdminSummary',
      priority: 30,
      permissions: [Permission.SurfaceContribute],
    },
  },
  navigation: {
    location: 'dashboard.sidebar',
    fallbackLabel: 'CMS',
    path: '/cms-demo',
    weight: 45,
    requires: {
      entitlements: ['ploykit.demo_modules'],
    },
  },
});
