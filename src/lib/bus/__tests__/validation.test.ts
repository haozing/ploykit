/**
 *
 */

import { describe, it, expect } from 'vitest';
import { BusValidator } from '../validation';

describe('BusValidator', () => {
  // ==========================================================================
  // 1. pluginId Validation
  // ==========================================================================

  describe('validatePluginId', () => {
    it('should接受ValidofpluginId', () => {
      expect(() => {
        BusValidator.validatePluginId('my-plugin', 'test');
      }).not.toThrow();

      expect(() => {
        BusValidator.validatePluginId('plugin123', 'test');
      }).not.toThrow();

      expect(() => {
        BusValidator.validatePluginId('my-plugin-name', 'test');
      }).not.toThrow();
    });

    it('should拒绝空字符串', () => {
      expect(() => {
        BusValidator.validatePluginId('', 'test');
      }).toThrow('cannot be empty');
    });

    it('should拒绝只有空格of字符串', () => {
      expect(() => {
        BusValidator.validatePluginId('   ', 'test');
      }).toThrow('cannot be empty');
    });

    it('should拒绝非字符串Type', () => {
      expect(() => {
        // @ts-expect-error - Testing runtime validation with invalid type
        BusValidator.validatePluginId(123, 'test');
      }).toThrow('must be a string');

      expect(() => {
        // @ts-expect-error - Testing runtime validation with null
        BusValidator.validatePluginId(null, 'test');
      }).toThrow('must be a string');
    });

    it('should拒绝包含大写字母ofpluginId', () => {
      expect(() => {
        BusValidator.validatePluginId('My-Plugin', 'test');
      }).toThrow('lowercase letters');
    });

    it('should拒绝包含下划线ofpluginId', () => {
      expect(() => {
        BusValidator.validatePluginId('my_plugin', 'test');
      }).toThrow('lowercase letters');
    });

    it('should拒绝包含特殊字符ofpluginId', () => {
      expect(() => {
        BusValidator.validatePluginId('my@plugin', 'test');
      }).toThrow('lowercase letters');

      expect(() => {
        BusValidator.validatePluginId('my.plugin', 'test');
      }).toThrow('lowercase letters');
    });

    it('ErrorMessageshould包含context', () => {
      try {
        BusValidator.validatePluginId('', 'MyContext');
        throw new Error('Should have thrown');
      } catch (error) {
        if (error instanceof Error) {
          expect(error.message).toContain('MyContext');
        }
      }
    });
  });

  // ==========================================================================
  // 2. HookNameValidation
  // ==========================================================================

  describe('validateHookName', () => {
    it('should接受AllValidofHookName', () => {
      const validHooks = [
        'onInstall',
        'onEnable',
        'onDisable',
        'onUninstall',
        'onUpgrade',
        'onBeforeHandle',
        'onAfterHandle',
        'onRouteResolve',
        'onRenderHead',
        'onSitemap',
        'onEvent',
      ];

      validHooks.forEach((hookName) => {
        expect(() => {
          BusValidator.validateHookName(hookName, 'test');
        }).not.toThrow();
      });
    });

    it('should拒绝invalidofHookName', () => {
      expect(() => {
        BusValidator.validateHookName('onInvalidHook', 'test');
      }).toThrow('Invalid hook name');

      expect(() => {
        BusValidator.validateHookName('someRandomHook', 'test');
      }).toThrow('Invalid hook name');
    });

    it('ErrorMessageshould列出AllValidofHookName', () => {
      try {
        BusValidator.validateHookName('invalid', 'test');
        throw new Error('Should have thrown');
      } catch (error) {
        if (error instanceof Error) {
          expect(error.message).toContain('onInstall');
          expect(error.message).toContain('onEnable');
          expect(error.message).toContain('onRenderHead');
        }
      }
    });
  });

  // ==========================================================================
  // 3. Event nameValidation
  // ==========================================================================

  describe('validateEventName', () => {
    it('should接受ValidofEvent name', () => {
      expect(() => {
        BusValidator.validateEventName('user.created', 'test');
      }).not.toThrow();

      expect(() => {
        BusValidator.validateEventName('order.updated', 'test');
      }).not.toThrow();

      expect(() => {
        BusValidator.validateEventName('any-string', 'test');
      }).not.toThrow();
    });

    it('should拒绝空字符串', () => {
      expect(() => {
        BusValidator.validateEventName('', 'test');
      }).toThrow('cannot be empty');
    });

    it('should拒绝只有空格of字符串', () => {
      expect(() => {
        BusValidator.validateEventName('   ', 'test');
      }).toThrow('cannot be empty');
    });

    it('should拒绝非字符串Type', () => {
      expect(() => {
        // @ts-expect-error - Testing runtime validation with invalid type
        BusValidator.validateEventName(123, 'test');
      }).toThrow('must be a string');
    });
  });

  // ==========================================================================
  // 4. ServiceNameValidation
  // ==========================================================================

  describe('validateServiceName', () => {
    it('should接受符合FormatofServiceName', () => {
      expect(() => {
        BusValidator.validateServiceName('service:order@v1', 'test');
      }).not.toThrow();

      expect(() => {
        BusValidator.validateServiceName('service:user@v2', 'test');
      }).not.toThrow();

      expect(() => {
        BusValidator.validateServiceName('namespace:name@version', 'test');
      }).not.toThrow();
    });

    it('should拒绝空字符串', () => {
      expect(() => {
        BusValidator.validateServiceName('', 'test');
      }).toThrow('cannot be empty');
    });

    it('should reject service name without colon', () => {
      expect(() => {
        BusValidator.validateServiceName('invalidname', 'test');
      }).toThrow('must contain a colon separator');
    });

    it('should拒绝非字符串Type', () => {
      expect(() => {
        // @ts-expect-error - Testing runtime validation with invalid type
        BusValidator.validateServiceName(123, 'test');
      }).toThrow('must be a string');
    });

    it('error message should describe recommended format', () => {
      try {
        BusValidator.validateServiceName('invalid', 'test');
        throw new Error('Should have thrown');
      } catch (error) {
        if (error instanceof Error) {
          expect(error.message).toContain('service:name');
        }
      }
    });
  });

  // ==========================================================================
  // ==========================================================================

  describe('validatePriority', () => {
    it('should接受Validof优先级值', () => {
      expect(() => {
        BusValidator.validatePriority(0, 'test');
      }).not.toThrow();

      expect(() => {
        BusValidator.validatePriority(100, 'test');
      }).not.toThrow();

      expect(() => {
        BusValidator.validatePriority(999, 'test');
      }).not.toThrow();
    });

    it('should拒绝负数', () => {
      expect(() => {
        BusValidator.validatePriority(-1, 'test');
      }).toThrow('non-negative');
    });

    it('should拒绝NaN', () => {
      expect(() => {
        BusValidator.validatePriority(NaN, 'test');
      }).toThrow('must be a number');
    });

    it('should拒绝非数字Type', () => {
      expect(() => {
        // @ts-expect-error - Testing runtime validation with invalid type
        BusValidator.validatePriority('100', 'test');
      }).toThrow('must be a number');

      expect(() => {
        // @ts-expect-error - Testing runtime validation with null
        BusValidator.validatePriority(null, 'test');
      }).toThrow('must be a number');
    });
  });

  // ==========================================================================
  // ==========================================================================

  describe('Error Messages with Context', () => {
    it('AllValidationError都should包含context', () => {
      const testContext = 'MySpecialContext';

      try {
        BusValidator.validatePluginId('', testContext);
      } catch (error) {
        if (error instanceof Error) {
          expect(error.message).toContain(testContext);
        }
      }

      try {
        BusValidator.validateEventName('', testContext);
      } catch (error) {
        if (error instanceof Error) {
          expect(error.message).toContain(testContext);
        }
      }

      try {
        BusValidator.validateServiceName('', testContext);
      } catch (error) {
        if (error instanceof Error) {
          expect(error.message).toContain(testContext);
        }
      }

      try {
        BusValidator.validatePriority(-1, testContext);
      } catch (error) {
        if (error instanceof Error) {
          expect(error.message).toContain(testContext);
        }
      }
    });
  });
});
