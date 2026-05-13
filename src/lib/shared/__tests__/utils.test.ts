/**
 * Unit tests for lib/utils.ts
 *
 * Tests utility functions
 */

import { cn } from '../../_core/utils';

describe('lib/utils', () => {
  describe('cn (className merge utility)', () => {
    it('should merge class names', () => {
      const result = cn('px-2 py-1', 'bg-blue-500');
      expect(result).toBeTruthy();
      expect(result).toContain('px-2');
      expect(result).toContain('py-1');
      expect(result).toContain('bg-blue-500');
    });

    it('should handle conditional classes', () => {
      const result = cn('base-class', true && 'conditional-class', false && 'hidden-class');
      expect(result).toContain('base-class');
      expect(result).toContain('conditional-class');
      expect(result).not.toContain('hidden-class');
    });

    it('should resolve Tailwind conflicts', () => {
      const result = cn('px-2', 'px-4');
      // tailwind-merge should keep only px-4
      expect(result).toContain('px-4');
      expect(result).not.toContain('px-2');
    });

    it('should handle arrays', () => {
      const result = cn(['class1', 'class2'], 'class3');
      expect(result).toContain('class1');
      expect(result).toContain('class2');
      expect(result).toContain('class3');
    });

    it('should handle objects', () => {
      const result = cn({
        class1: true,
        class2: false,
        class3: true,
      });
      expect(result).toContain('class1');
      expect(result).not.toContain('class2');
      expect(result).toContain('class3');
    });

    it('should handle undefined and null', () => {
      const result = cn('base', undefined, null, 'other');
      expect(result).toContain('base');
      expect(result).toContain('other');
    });

    it('should handle empty input', () => {
      const result = cn();
      expect(result).toBe('');
    });

    it('should handle complex scenarios', () => {
      const isActive = true;
      const isDisabled = false;
      const result = cn(
        'btn',
        isActive && 'btn-active',
        isDisabled && 'btn-disabled',
        { 'btn-primary': true },
        ['px-4', 'py-2']
      );
      expect(result).toContain('btn');
      expect(result).toContain('btn-active');
      expect(result).not.toContain('btn-disabled');
      expect(result).toContain('btn-primary');
      expect(result).toContain('px-4');
      expect(result).toContain('py-2');
    });

    it('should handle Tailwind prefix conflicts', () => {
      const result = cn('p-2', 'p-4', 'px-6');
      // Should keep px-6 and p-4 (or resolve conflicts properly)
      expect(result).toContain('p-4');
      expect(result).toContain('px-6');
    });
  });
});
