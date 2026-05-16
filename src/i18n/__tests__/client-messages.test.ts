import { describe, expect, it } from 'vitest';
import { getClientMessagesForScope } from '../client-messages';

const messages = {
  common: {
    ok: 'OK',
  },
  errors: {
    title: 'Error',
  },
  home: {
    hero: {
      title: 'Home',
    },
  },
  pricing: {
    hero: {
      title: 'Pricing',
    },
  },
  auth: {
    login: {
      title: 'Login',
    },
  },
  dashboard: {
    profile: {
      title: 'Profile',
    },
  },
  components: {
    shared: {
      userDropdown: {
        logout: 'Logout',
      },
    },
  },
  'custom-plugin': {
    menu: {
      label: 'Story',
    },
  },
};

describe('getClientMessagesForScope', () => {
  it('keeps global messages small', () => {
    const result = getClientMessagesForScope(messages, 'global');

    expect(result).toEqual({
      common: messages.common,
      errors: messages.errors,
      components: messages.components,
      'custom-plugin': messages['custom-plugin'],
    });
  });

  it('adds public site messages without dashboard or auth namespaces', () => {
    const result = getClientMessagesForScope(messages, 'site');

    expect(result).toMatchObject({
      common: messages.common,
      errors: messages.errors,
      home: messages.home,
      pricing: messages.pricing,
      'custom-plugin': messages['custom-plugin'],
    });
    expect(result).not.toHaveProperty('auth');
    expect(result).not.toHaveProperty('dashboard');
  });

  it('adds dashboard messages and shared components for authenticated shells', () => {
    const result = getClientMessagesForScope(messages, 'dashboard');

    expect(result).toMatchObject({
      common: messages.common,
      errors: messages.errors,
      dashboard: messages.dashboard,
      components: messages.components,
      'custom-plugin': messages['custom-plugin'],
    });
    expect(result).not.toHaveProperty('home');
    expect(result).not.toHaveProperty('pricing');
  });
});
