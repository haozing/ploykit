import { z } from 'zod';

/**
 * Plan Validation Schemas
 */

// Reserved slugs for plans
const RESERVED_PLAN_SLUGS = ['admin', 'system', 'test', 'demo', 'api'];

// Plan slug schema
const planSlugSchema = z
  .string()
  .min(2, 'Plan slug must be at least 2 characters')
  .max(50, 'Plan slug must not exceed 50 characters')
  .regex(/^[a-z0-9-]+$/, 'Plan slug must be lowercase alphanumeric with hyphens only')
  .refine(
    (slug) => !RESERVED_PLAN_SLUGS.includes(slug),
    (slug) => ({ message: `Plan slug '${slug}' is reserved` })
  )
  .refine(
    (slug) => !slug.startsWith('-') && !slug.endsWith('-'),
    'Plan slug cannot start or end with hyphen'
  )
  .refine((slug) => !slug.includes('--'), 'Plan slug cannot contain consecutive hyphens');

const featureKeySchema = z
  .string()
  .min(1, 'Feature key is required')
  .max(120, 'Feature key is too long')
  .refine((key) => key.includes('.'), 'Feature key must use the ${namespace}.xxx convention');

// Plan features schema (machine-enforced capabilities/constraints)
const planFeaturesSchema = z
  .record(featureKeySchema, z.union([z.boolean(), z.string(), z.number()]))
  .default({});

const planTranslationSchema = z.object({
  name: z.string().max(100).optional(),
  description: z.string().max(500).optional(),
  featuresList: z.array(z.string().min(1).max(200)).max(80).optional(),
  buttonText: z.string().max(80).optional(),
  highlightedText: z.string().max(120).optional(),
});

const planLangJsonbSchema = z.record(z.string().min(1).max(20), planTranslationSchema).optional();

// Limit keys must follow the ${pluginId}.xxx convention
const limitKeySchema = z
  .string()
  .min(1, 'Limit key is required')
  .max(120, 'Limit key is too long')
  .refine((key) => key.includes('.'), 'Limit key must use the ${pluginId}.xxx convention');

const limitValueSchema = z.number().int().min(-1, 'Limit must be -1 (unlimited) or 0+');

const limitsRecordSchema = z.record(limitKeySchema, limitValueSchema);
const planLimitsSchema = z
  .object({
    monthly: limitsRecordSchema,
    yearly: limitsRecordSchema,
  })
  .default({ monthly: {}, yearly: {} });

const planPricingSchema = z
  .object({
    currency: z
      .string()
      .length(3, 'Currency must be 3-letter ISO code')
      .regex(/^[A-Z]{3}$/, 'Currency must be uppercase ISO 4217 code')
      .optional(),
    monthly: z.number().nonnegative().max(999999).optional(),
    yearly: z.number().nonnegative().max(999999).optional(),
  })
  .default({});

const planStripeSchema = z
  .object({
    productId: z.string().nullable().optional(),
    priceIdMonthly: z.string().nullable().optional(),
    priceIdYearly: z.string().nullable().optional(),
  })
  .default({});

// Create plan schema
export const createPlanSchema = z.object({
  name: z
    .string()
    .min(2, 'Plan name must be at least 2 characters')
    .max(100, 'Plan name must not exceed 100 characters'),
  slug: planSlugSchema,
  features: planFeaturesSchema,
  limits: planLimitsSchema,
  langJsonb: planLangJsonbSchema.optional(),
  pricing: planPricingSchema.optional(),
  stripe: planStripeSchema.optional(),
  sortOrder: z.number().int().nonnegative('Sort order must be non-negative').default(0).optional(),
  isActive: z.boolean().default(true).optional(),
  isDefault: z.boolean().default(false).optional(),
  isPopular: z.boolean().default(false).optional(),
});

export type CreatePlanInput = z.infer<typeof createPlanSchema>;

// Update plan schema
export const updatePlanSchema = z
  .object({
    name: z.string().min(2).max(100).optional(),
    slug: planSlugSchema.optional(),
    features: planFeaturesSchema.optional(),
    limits: planLimitsSchema.optional(),
    langJsonb: planLangJsonbSchema.optional(),
    pricing: planPricingSchema.optional(),
    stripe: planStripeSchema.optional(),
    sortOrder: z.number().int().nonnegative().optional(),
    isActive: z.boolean().optional(),
    isDefault: z.boolean().optional(),
    isPopular: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'At least one field must be provided for update');

export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;

// Plan filters schema
export const planFiltersSchema = z.object({
  isActive: z.boolean().optional(),
});

export type PlanFiltersInput = z.infer<typeof planFiltersSchema>;
