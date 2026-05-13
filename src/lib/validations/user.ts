import { z } from 'zod';

/**
 * User Validation Schemas
 */

export const emailSchema = z
  .string()
  .email('Invalid email address')
  .min(3, 'Email must be at least 3 characters')
  .max(255, 'Email must not exceed 255 characters')
  .toLowerCase()
  .trim();

export const userNameSchema = z
  .string()
  .min(1, 'Name is required')
  .max(100, 'Name must not exceed 100 characters')
  .regex(/^[\p{L}\p{M}\p{N}\s'’._-]+$/u, 'Name contains invalid characters')
  .trim();

export const imageUrlSchema = z
  .string()
  .url('Invalid image URL')
  .max(2048, 'Image URL must not exceed 2048 characters')
  .optional();

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(100, 'Password must not exceed 100 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .optional(); // Optional because OAuth users don't need password

// Create user schema
export const createUserSchema = z.object({
  email: emailSchema,
  name: userNameSchema,
  image: imageUrlSchema,
  password: passwordSchema,
  emailVerified: z.boolean().default(false),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

// Update user schema
export const updateUserSchema = z
  .object({
    name: userNameSchema.optional(),
    email: emailSchema.optional(),
    image: imageUrlSchema,
  })
  .refine(
    (data) => data.name || data.email || data.image,
    'At least one field must be provided for update'
  );

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

// User filters schema
export const userFiltersSchema = z.object({
  search: z.string().min(1).max(100).optional(),
  status: z.enum(['active', 'pending', 'suspended', 'deleted']).optional(),
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
});

export type UserFiltersInput = z.infer<typeof userFiltersSchema>;

// Search users schema
export const searchUsersSchema = z.object({
  query: z.string().min(2, 'Search query must be at least 2 characters').max(100),
  limit: z.number().int().positive().max(50).default(10),
});

export type SearchUsersInput = z.infer<typeof searchUsersSchema>;

// Update profile schema (for user's own profile)
export const updateProfileSchema = z.object({
  name: userNameSchema.optional(),
  image: imageUrlSchema,
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// Change password schema
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().optional(),
    newPassword: passwordSchema.unwrap(), // Remove optional wrapper
    confirmPassword: z.string().min(1, 'Confirm password is required'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'New password must be different from current password',
    path: ['newPassword'],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// Update user preferences schema
// Note: 'auto' is used instead of 'system' to match database schema (userPreferences type)
export const updatePreferencesSchema = z.object({
  theme: z.enum(['light', 'dark', 'auto']).optional(),
  language: z.enum(['en', 'zh']).optional(),
  timezone: z.string().max(50).optional(),
  marketingEmails: z.boolean().optional(),
  securityAlerts: z.boolean().optional(),
  productUpdates: z.boolean().optional(),
  billingAlerts: z.boolean().optional(),
});

export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;
