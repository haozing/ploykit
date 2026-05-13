import { z } from 'zod';

export const generalSystemSettingsSchema = z
  .object({
    siteName: z.string().trim().min(1).max(120),
    supportEmail: z.string().trim().email().max(255),
    defaultLocale: z.enum(['en', 'zh']),
    timezone: z.string().trim().min(1).max(80),
  })
  .strict();

export const securitySystemSettingsSchema = z
  .object({
    requireEmailVerification: z.boolean(),
    sessionMaxAgeDays: z.number().int().min(1).max(365),
    passwordMinLength: z.number().int().min(8).max(128),
  })
  .strict();

export const emailSystemSettingsSchema = z
  .object({
    provider: z.enum(['log', 'smtp', 'resend']),
    fromEmail: z.string().trim().email().max(255),
    fromName: z.string().trim().min(1).max(120),
    passwordResetDelivery: z.enum(['log', 'email']),
  })
  .strict();

export const notificationSystemSettingsSchema = z
  .object({
    inAppEnabled: z.boolean(),
    emailEnabled: z.boolean(),
    webhookEnabled: z.boolean(),
    digestFrequency: z.enum(['never', 'daily', 'weekly']),
  })
  .strict();

export const systemSettingsPayloadSchema = z
  .object({
    general: generalSystemSettingsSchema,
    security: securitySystemSettingsSchema,
    email: emailSystemSettingsSchema,
    notifications: notificationSystemSettingsSchema,
  })
  .strict();

export type SystemSettingsPayload = z.infer<typeof systemSettingsPayloadSchema>;
