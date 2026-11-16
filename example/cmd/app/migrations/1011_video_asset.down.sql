-- Down for 1011: drop the asset registry (product-owned table, 1xxx).
DROP INDEX IF EXISTS idx_video_asset_project;
DROP TABLE IF EXISTS video_asset;
