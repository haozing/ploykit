import { describe, expect, it } from 'vitest';
import { fileIdParamsSchema } from '../file';

describe('file validation schemas', () => {
  it('accepts URL-safe text IDs generated for uploaded files', () => {
    expect(
      fileIdParamsSchema.safeParse({
        id: 'UjOtGast-KiT74qF8ZYOD',
      }).success
    ).toBe(true);
  });

  it('rejects unsafe file ID path segments', () => {
    expect(
      fileIdParamsSchema.safeParse({
        id: '../secret',
      }).success
    ).toBe(false);
  });
});
