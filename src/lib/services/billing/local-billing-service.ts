import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { requireUserContext, withSystemContext } from '@/lib/db';
import {
  billingInvoices,
  billingPaymentMethods,
  billingTaxProfiles,
  type InvoiceStatus,
  type PaymentMethodStatus,
  type TaxProfileStatus,
} from '@/lib/db/schema';

export const localInvoiceSchema = z.object({
  userId: z.string().min(1),
  orderId: z.string().uuid().optional(),
  provider: z.string().min(1).default('local'),
  providerInvoiceId: z.string().min(1).optional(),
  invoiceNumber: z.string().min(1),
  status: z.enum(['draft', 'open', 'paid', 'void', 'uncollectible', 'refunded']).default('open'),
  currency: z.string().length(3).default('USD'),
  subtotalAmount: z.string().default('0'),
  taxAmount: z.string().default('0'),
  totalAmount: z.string().default('0'),
  hostedUrl: z.string().url().optional(),
  pdfUrl: z.string().url().optional(),
  dueAt: z.coerce.date().optional(),
  paidAt: z.coerce.date().optional(),
  metadata: z.record(z.unknown()).default({}),
});

export const localPaymentMethodSchema = z.object({
  userId: z.string().min(1),
  provider: z.string().min(1).default('local'),
  providerPaymentMethodId: z.string().min(1).optional(),
  type: z.string().min(1),
  brand: z.string().optional(),
  last4: z
    .string()
    .regex(/^\d{4}$/)
    .optional(),
  expMonth: z.number().int().min(1).max(12).optional(),
  expYear: z.number().int().min(2000).max(2200).optional(),
  billingName: z.string().optional(),
  billingEmail: z.string().email().optional(),
  billingCountry: z.string().length(2).optional(),
  status: z.enum(['active', 'expired', 'removed']).default('active'),
  isDefault: z.boolean().default(false),
  metadata: z.record(z.unknown()).default({}),
});

export const taxProfileSchema = z.object({
  userId: z.string().min(1),
  legalName: z.string().optional(),
  taxId: z.string().optional(),
  taxIdType: z.string().optional(),
  country: z.string().length(2),
  region: z.string().optional(),
  city: z.string().optional(),
  postalCode: z.string().optional(),
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional(),
  status: z.enum(['active', 'archived']).default('active'),
  metadata: z.record(z.unknown()).default({}),
});

export type LocalInvoiceInput = z.input<typeof localInvoiceSchema>;
export type LocalPaymentMethodInput = z.input<typeof localPaymentMethodSchema>;
export type TaxProfileInput = z.input<typeof taxProfileSchema>;

export async function createLocalInvoice(input: LocalInvoiceInput) {
  const data = localInvoiceSchema.parse(input);

  return withSystemContext(async (database) => {
    const [invoice] = await database
      .insert(billingInvoices)
      .values({
        ...data,
        status: data.status as InvoiceStatus,
      })
      .returning();

    return invoice;
  });
}

export async function upsertProviderInvoice(
  input: LocalInvoiceInput & {
    provider: string;
    providerInvoiceId: string;
    invoiceNumber: string;
  }
) {
  const data = localInvoiceSchema.parse(input);
  if (!data.providerInvoiceId) {
    throw new Error('providerInvoiceId is required for provider invoices');
  }
  const providerInvoiceId = data.providerInvoiceId;

  return withSystemContext(async (database) => {
    const [existing] = await database
      .select()
      .from(billingInvoices)
      .where(
        and(
          eq(billingInvoices.provider, data.provider),
          eq(billingInvoices.providerInvoiceId, providerInvoiceId)
        )
      )
      .limit(1);

    if (existing) {
      const [invoice] = await database
        .update(billingInvoices)
        .set({
          ...data,
          status: data.status as InvoiceStatus,
          updatedAt: new Date(),
        })
        .where(eq(billingInvoices.id, existing.id))
        .returning();

      return invoice;
    }

    const [invoice] = await database
      .insert(billingInvoices)
      .values({
        ...data,
        status: data.status as InvoiceStatus,
      })
      .returning();

    return invoice;
  });
}

export async function markInvoicesForOrderStatus(
  orderId: string,
  status: InvoiceStatus,
  metadata?: Record<string, unknown>
) {
  return withSystemContext(async (database) => {
    const existingInvoices = await database
      .select()
      .from(billingInvoices)
      .where(eq(billingInvoices.orderId, orderId));

    const updatedInvoices = [];
    for (const existing of existingInvoices) {
      const [invoice] = await database
        .update(billingInvoices)
        .set({
          status,
          metadata: {
            ...((existing.metadata as Record<string, unknown>) || {}),
            ...(metadata || {}),
          },
          updatedAt: new Date(),
        })
        .where(eq(billingInvoices.id, existing.id))
        .returning();

      if (invoice) {
        updatedInvoices.push(invoice);
      }
    }

    return updatedInvoices;
  });
}

export async function listUserInvoices(userId: string, limit = 50, offset = 0) {
  return requireUserContext(userId, async (database) => {
    return database
      .select()
      .from(billingInvoices)
      .where(eq(billingInvoices.userId, userId))
      .orderBy(desc(billingInvoices.issuedAt))
      .limit(limit)
      .offset(offset);
  });
}

export async function listAllInvoices(limit = 50, offset = 0) {
  return withSystemContext(async (database) => {
    return database
      .select()
      .from(billingInvoices)
      .orderBy(desc(billingInvoices.issuedAt))
      .limit(limit)
      .offset(offset);
  });
}

export async function upsertPaymentMethod(input: LocalPaymentMethodInput) {
  const data = localPaymentMethodSchema.parse(input);

  return withSystemContext(async (database) => {
    if (data.isDefault) {
      await database
        .update(billingPaymentMethods)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(billingPaymentMethods.userId, data.userId));
    }

    const [method] = await database
      .insert(billingPaymentMethods)
      .values({
        ...data,
        status: data.status as PaymentMethodStatus,
      })
      .returning();

    return method;
  });
}

export async function listUserPaymentMethods(userId: string) {
  return requireUserContext(userId, async (database) => {
    return database
      .select()
      .from(billingPaymentMethods)
      .where(
        and(eq(billingPaymentMethods.userId, userId), eq(billingPaymentMethods.status, 'active'))
      )
      .orderBy(desc(billingPaymentMethods.isDefault));
  });
}

export async function upsertTaxProfile(input: TaxProfileInput) {
  const data = taxProfileSchema.parse(input);

  return withSystemContext(async (database) => {
    const [existing] = await database
      .select()
      .from(billingTaxProfiles)
      .where(
        and(eq(billingTaxProfiles.userId, data.userId), eq(billingTaxProfiles.status, 'active'))
      )
      .limit(1);

    if (existing) {
      const [profile] = await database
        .update(billingTaxProfiles)
        .set({
          ...data,
          status: data.status as TaxProfileStatus,
          updatedAt: new Date(),
        })
        .where(eq(billingTaxProfiles.id, existing.id))
        .returning();

      return profile;
    }

    const [profile] = await database
      .insert(billingTaxProfiles)
      .values({
        ...data,
        status: data.status as TaxProfileStatus,
      })
      .returning();

    return profile;
  });
}

export async function getUserTaxProfile(userId: string) {
  return requireUserContext(userId, async (database) => {
    const [profile] = await database
      .select()
      .from(billingTaxProfiles)
      .where(and(eq(billingTaxProfiles.userId, userId), eq(billingTaxProfiles.status, 'active')))
      .limit(1);

    return profile ?? null;
  });
}
