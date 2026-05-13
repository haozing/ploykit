/**
 *
 * - isEnabled() - CheckPluginWhetherEnable
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PluginQueryService } from '../plugin-query.server';
import {
  createMockInstallation,
  createMockQueryBuilder,
  clearAllMocks,
  TEST_PLUGIN_ID,
} from './helpers';

// Mock dependencies
vi.mock('@/lib/db/client.server', () => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock('@/lib/db/schema/plugins', () => ({
  pluginInstallations: {
    id: 'id',
    pluginId: 'pluginId',
    version: 'version',
    enabled: 'enabled',
    installedAt: 'installedAt',
    updatedAt: 'updatedAt',
    installedBy: 'installedBy',
  },
}));

import { db } from '@/lib/db/client.server';

describe('Plugin Query Service', () => {
  let queryService: PluginQueryService;

  beforeEach(() => {
    clearAllMocks();
    queryService = new PluginQueryService();
  });

  //
  // listInstalledPlugins() Tests
  //

  describe('listInstalledPlugins', () => {
    it('shouldBackAll已InstallofPlugin', async () => {
      // Arrange
      const mockInstallations = [
        createMockInstallation({ pluginId: 'plugin-1' }),
        createMockInstallation({ pluginId: 'plugin-2', enabled: true }),
      ];

      const mockBuilder = createMockQueryBuilder(mockInstallations);
      vi.mocked(db.select).mockReturnValue(mockBuilder as any);

      // Act
      const result = await queryService.listInstalledPlugins();

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0].pluginId).toBe('plugin-1');
      expect(result[1].pluginId).toBe('plugin-2');
      expect(result[1].enabled).toBe(true);
    });

    it('shouldBack空ArrayWhen没有InstallPluginwhen', async () => {
      // Arrange
      const mockBuilder = createMockQueryBuilder([]);
      vi.mocked(db.select).mockReturnValue(mockBuilder as any);

      // Act
      const result = await queryService.listInstalledPlugins();

      // Assert
      expect(result).toEqual([]);
    });
  });

  //
  // getInstallation() Tests
  //

  describe('getInstallation', () => {
    it('shouldBackPluginInstallRecord', async () => {
      // Arrange
      const mockInstallation = createMockInstallation();
      const mockBuilder = createMockQueryBuilder([mockInstallation]);
      vi.mocked(db.select).mockReturnValue(mockBuilder as any);

      // Act
      const result = await queryService.getInstallation(TEST_PLUGIN_ID);

      // Assert
      expect(result).not.toBeNull();
      expect(result?.pluginId).toBe(TEST_PLUGIN_ID);
      expect(mockBuilder.where).toHaveBeenCalled();
      expect(mockBuilder.limit).toHaveBeenCalledWith(1);
    });

    it('shouldBack null WhenPlugin未Installwhen', async () => {
      // Arrange
      const mockBuilder = createMockQueryBuilder([]);
      vi.mocked(db.select).mockReturnValue(mockBuilder as any);

      // Act
      const result = await queryService.getInstallation('non-existent');

      // Assert
      expect(result).toBeNull();
    });
  });

  //
  // isEnabled() Tests
  //

  describe('isEnabled', () => {
    it('shouldBack true WhenPluginEnabled', async () => {
      // Arrange
      const mockInstallation = createMockInstallation({ enabled: true });
      const mockBuilder = createMockQueryBuilder([mockInstallation]);
      vi.mocked(db.select).mockReturnValue(mockBuilder as any);

      // Act
      const result = await queryService.isEnabled(TEST_PLUGIN_ID);

      // Assert
      expect(result).toBe(true);
    });

    it('shouldBack false WhenPlugin已Install但未Enable', async () => {
      // Arrange
      const mockInstallation = createMockInstallation({ enabled: false });
      const mockBuilder = createMockQueryBuilder([mockInstallation]);
      vi.mocked(db.select).mockReturnValue(mockBuilder as any);

      // Act
      const result = await queryService.isEnabled(TEST_PLUGIN_ID);

      // Assert
      expect(result).toBe(false);
    });

    it('shouldBack false WhenPlugin未Install', async () => {
      // Arrange
      const mockBuilder = createMockQueryBuilder([]);
      vi.mocked(db.select).mockReturnValue(mockBuilder as any);

      // Act
      const result = await queryService.isEnabled(TEST_PLUGIN_ID);

      // Assert
      expect(result).toBe(false);
    });
  });

  //
  // mapInstallation() Tests
  //

  describe('mapInstallation', () => {
    it('should正确映射DatabaseRecord', () => {
      // Arrange
      const dbRecord = {
        id: '1',
        pluginId: TEST_PLUGIN_ID,
        version: '1.0.0',
        enabled: true,
        installedAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
        installedBy: 'user-123',
      };

      // Act
      const result = queryService.mapInstallation(dbRecord as any);

      // Assert
      expect(result).toEqual({
        id: '1',
        pluginId: TEST_PLUGIN_ID,
        version: '1.0.0',
        enabled: true,
        installedAt: dbRecord.installedAt,
        updatedAt: dbRecord.updatedAt,
        installedBy: 'user-123',
      });
    });

    it('should将 null installedBy Transformas undefined', () => {
      // Arrange
      const dbRecord = {
        id: '1',
        pluginId: TEST_PLUGIN_ID,
        version: '1.0.0',
        enabled: false,
        installedAt: new Date(),
        updatedAt: new Date(),
        installedBy: null,
      };

      // Act
      const result = queryService.mapInstallation(dbRecord as any);

      // Assert
      expect(result.installedBy).toBeUndefined();
    });
  });
});
