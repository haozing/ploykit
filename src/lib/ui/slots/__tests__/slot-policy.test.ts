/**
 * Slot Policy Tests
 *
 * Covers:
 * - Slot trust level classification
 * - Elevated trust requirements for head/body slots
 * - Plugin trust validation against slot requirements
 * - Audit-only mode behavior
 * - Filter batch of registrations
 */

import { describe, it, expect } from 'vitest';
import {
  getSlotTrustLevel,
  requiresElevatedTrust,
  getRequiredPluginTrust,
  getPluginTrustLevelForSlots,
  validateSlotRegistration,
  filterSlotsByPolicy,
} from '../slot-policy.server';
import type { SlotRegistration } from '../types';

describe('Slot Policy', () => {
  describe('getSlotTrustLevel', () => {
    it('should classify head slots as head trust level', () => {
      expect(getSlotTrustLevel('head:meta')).toBe('head');
      expect(getSlotTrustLevel('head:scripts')).toBe('head');
    });

    it('should classify body slots as body trust level', () => {
      expect(getSlotTrustLevel('body:start')).toBe('body');
      expect(getSlotTrustLevel('body:end')).toBe('body');
    });

    it('should classify content slots as content trust level', () => {
      expect(getSlotTrustLevel('header:logo')).toBe('content');
      expect(getSlotTrustLevel('route:/json:main.before')).toBe('content');
      expect(getSlotTrustLevel('site.contact:main.before')).toBe('content');
      expect(getSlotTrustLevel('footer:extra')).toBe('content');
    });
  });

  describe('requiresElevatedTrust', () => {
    it('should return true for head and body slots', () => {
      expect(requiresElevatedTrust('head:meta')).toBe(true);
      expect(requiresElevatedTrust('body:start')).toBe(true);
    });

    it('should return false for content slots', () => {
      expect(requiresElevatedTrust('header:logo')).toBe(false);
      expect(requiresElevatedTrust('site.home:hero.before')).toBe(false);
    });
  });

  describe('getRequiredPluginTrust', () => {
    it('should require system trust for head slots', () => {
      expect(getRequiredPluginTrust('head:meta')).toBe('system');
      expect(getRequiredPluginTrust('head:scripts')).toBe('system');
    });

    it('should require system trust for body slots', () => {
      expect(getRequiredPluginTrust('body:start')).toBe('system');
      expect(getRequiredPluginTrust('body:end')).toBe('system');
    });

    it('should require trusted for content slots', () => {
      expect(getRequiredPluginTrust('header:logo')).toBe('trusted');
      expect(getRequiredPluginTrust('route:/json:main.before')).toBe('trusted');
      expect(getRequiredPluginTrust('site.contact:main.before')).toBe('trusted');
    });
  });

  describe('validateSlotRegistration', () => {
    const createRegistration = (slotName: string, pluginId = 'test-plugin'): SlotRegistration => ({
      pluginId,
      slotName: slotName as any,
      componentPath: './components/Test.tsx',
      priority: 100,
      enabled: true,
      registeredAt: new Date(),
    });

    it('should allow trusted plugin on content slot', () => {
      const reg = createRegistration('header:logo');
      const result = validateSlotRegistration(reg, { pluginTrustLevel: 'trusted' });
      expect(result.allowed).toBe(true);
    });

    it('should allow system plugin on head slot', () => {
      const reg = createRegistration('head:meta');
      const result = validateSlotRegistration(reg, { pluginTrustLevel: 'system' });
      expect(result.allowed).toBe(true);
    });

    it('should block trusted plugin on head slot', () => {
      const reg = createRegistration('head:meta');
      const result = validateSlotRegistration(reg, { pluginTrustLevel: 'trusted' });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('requires system trust level');
    });

    it('should block untrusted plugin on content slot', () => {
      const reg = createRegistration('header:logo');
      const result = validateSlotRegistration(reg, { pluginTrustLevel: 'untrusted' });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('requires trusted trust level');
    });

    it('should allow blocked registration in audit-only mode', () => {
      const reg = createRegistration('head:meta');
      const result = validateSlotRegistration(reg, {
        pluginTrustLevel: 'trusted',
        auditOnly: true,
      });
      expect(result.allowed).toBe(true);
    });

    it('should default to untrusted plugin trust level', () => {
      const reg = createRegistration('header:logo');
      const result = validateSlotRegistration(reg);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('has untrusted');
    });
  });

  describe('getPluginTrustLevelForSlots', () => {
    it('uses runtime contract trust level', () => {
      expect(getPluginTrustLevelForSlots({ trustLevel: 'system' })).toBe('system');
    });

    it('defaults plugin ids to untrusted', () => {
      expect(getPluginTrustLevelForSlots('local-plugin')).toBe('untrusted');
    });
  });

  describe('filterSlotsByPolicy', () => {
    const createRegs = (): SlotRegistration[] => [
      {
        pluginId: 'trusted-plugin',
        slotName: 'header:logo',
        componentPath: './Logo.tsx',
        priority: 100,
        enabled: true,
        registeredAt: new Date(),
      },
      {
        pluginId: 'untrusted-plugin',
        slotName: 'header:logo',
        componentPath: './BadLogo.tsx',
        priority: 100,
        enabled: true,
        registeredAt: new Date(),
      },
      {
        pluginId: 'trusted-plugin',
        slotName: 'head:meta',
        componentPath: './Meta.tsx',
        priority: 100,
        enabled: true,
        registeredAt: new Date(),
      },
    ];

    it('should separate allowed and blocked registrations', () => {
      const regs = createRegs();
      // With pluginTrustLevel 'trusted': content slots allowed, head slots blocked
      const result = filterSlotsByPolicy(regs, { pluginTrustLevel: 'trusted' });

      expect(result.allowed.length).toBe(2); // both content slots allowed
      expect(result.allowed.some((r) => r.slotName === 'header:logo')).toBe(true);

      expect(result.blocked.length).toBe(1); // head:meta blocked (requires system)
      expect(result.blocked[0].registration.slotName).toBe('head:meta');
    });

    it('should allow system plugin to use head slot', () => {
      const regs = createRegs();
      const result = filterSlotsByPolicy(regs, { pluginTrustLevel: 'system' });

      expect(result.allowed.length).toBe(3);
      expect(result.blocked.length).toBe(0);
    });

    it('should handle empty array', () => {
      const result = filterSlotsByPolicy([]);
      expect(result.allowed).toEqual([]);
      expect(result.blocked).toEqual([]);
    });
  });
});
