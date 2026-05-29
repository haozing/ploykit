import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyProductScopeToSession,
  createInMemoryProductScopeStore,
  resolveProductScope,
  shouldShowProductScopeSwitcher,
  type ProductScopeSnapshot,
} from '../src/lib/module-runtime';

const snapshot: ProductScopeSnapshot = {
  version: 1,
  products: [
    {
      id: 'alpha',
      name: 'Alpha',
      profile: 'hidden-default',
      defaultWorkspaceId: 'alpha-main',
    },
    {
      id: 'team',
      name: 'Team',
      profile: 'explicit-workspace',
      defaultWorkspaceId: 'team-main',
    },
  ],
  workspaces: [
    { id: 'alpha-main', productId: 'alpha', name: 'Alpha Main', slug: 'alpha' },
    { id: 'team-main', productId: 'team', name: 'Team Main', slug: 'team-main' },
    { id: 'team-lab', productId: 'team', name: 'Team Lab', slug: 'team-lab' },
  ],
  memberships: [
    {
      id: 'team:team-lab:user-1',
      productId: 'team',
      workspaceId: 'team-lab',
      userId: 'user-1',
      role: 'admin',
      status: 'active',
    },
  ],
  invites: [],
  domainAliases: [{ hostname: 'team.localhost', productId: 'team', workspaceId: 'team-lab' }],
};

test('P12 product scope resolver prefers domain aliases over session defaults', () => {
  const resolution = resolveProductScope({
    snapshot,
    request: new Request('http://team.localhost/dashboard'),
    session: {
      user: { id: 'user-1', role: 'user' },
      productId: 'alpha',
      workspaceId: 'alpha-main',
    },
  });

  assert.equal(resolution.source, 'domainAlias');
  assert.equal(resolution.product.id, 'team');
  assert.equal(resolution.workspace.id, 'team-lab');
  assert.equal(resolution.membership?.role, 'admin');
});

test('P12 product scope resolver supports explicit workspace URLs', () => {
  const resolution = resolveProductScope({
    snapshot,
    request: new Request('http://localhost/dashboard?workspace=team-main'),
    session: { user: { id: 'user-1', role: 'user' } },
  });

  assert.equal(resolution.source, 'urlWorkspace');
  assert.equal(resolution.workspace.id, 'team-main');
  assert.equal(shouldShowProductScopeSwitcher(resolution), true);
});

test('P12 product scope resolution can hydrate a host session', () => {
  const resolution = resolveProductScope({
    snapshot,
    request: new Request('http://team.localhost/dashboard'),
    session: { user: { id: 'user-1', role: 'user' } },
  });
  const session = applyProductScopeToSession({ user: { id: 'user-1', role: 'user' } }, resolution);

  assert.equal(session.productId, 'team');
  assert.equal(session.workspaceId, 'team-lab');
  assert.equal(session.workspaceRole, 'admin');
  assert.equal(session.productScopeProfile, 'explicit-workspace');
});

test('P12 product scope store accepts invites into memberships', async () => {
  const store = createInMemoryProductScopeStore(snapshot);
  await store.createInvite({
    productId: 'team',
    workspaceId: 'team-main',
    email: 'new@example.com',
    role: 'editor',
    token: 'invite-token',
    expiresAt: '2999-01-01T00:00:00.000Z',
    invitedBy: 'user-1',
  });

  const membership = await store.acceptInvite('invite-token', 'user-2');
  const nextSnapshot = await store.getSnapshot();

  assert.equal(membership?.role, 'editor');
  assert.equal(
    nextSnapshot.memberships.some(
      (item) => item.userId === 'user-2' && item.workspaceId === 'team-main'
    ),
    true
  );
  assert.equal(
    nextSnapshot.invites.find((invite) => invite.token === 'invite-token')?.status,
    'accepted'
  );
});
