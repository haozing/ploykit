'use client';

import { useEffect, useMemo, useState } from 'react';
import { useForm, useFieldArray, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useLocale, useTranslations } from 'next-intl';
import useSWR from 'swr';
import { useToast } from '@/hooks/use-toast';
import type { PlanWithSubscribers } from '@/hooks/use-entitlements';
import { API_KEYS, fetcher } from '@/lib/swr';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PLATFORM_PRIMARY_CREDIT_METRIC } from '@/lib/billing/billing-metrics';
import {
  getLocalizedPlanCapabilityText,
  getPlanCapabilityLabel,
  getPlanCapabilityOptionLabel,
  parsePlanCapabilityValue,
  type PlanCapabilityDefinition,
} from '@/lib/entitlements/plan-capability-types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Plus, Trash2 } from 'lucide-react';

type PlanCapabilitiesResponse = {
  success?: boolean;
  data?: PlanCapabilityDefinition[];
};

function capabilityInputValue(
  definition: PlanCapabilityDefinition,
  capabilities: Record<string, unknown>
): string | boolean | undefined {
  const rawValue = capabilities[definition.key] ?? definition.defaultValue;

  if (definition.valueType === 'boolean') {
    return rawValue === true || rawValue === 'true';
  }

  if (rawValue === undefined || rawValue === null) {
    return '';
  }

  return String(rawValue);
}

function buildCapabilityFormValues(
  definitions: readonly PlanCapabilityDefinition[],
  capabilities: Record<string, unknown>
): Array<{ key: string; value?: string | boolean }> {
  return definitions.map((definition) => ({
    key: definition.key,
    value: capabilityInputValue(definition, capabilities),
  }));
}

function readApiErrorMessage(json: unknown, fallback: string): string {
  if (!json || typeof json !== 'object') {
    return fallback;
  }
  const record = json as Record<string, unknown>;
  if (typeof record.error === 'string') {
    return record.error;
  }
  if (record.error && typeof record.error === 'object') {
    const error = record.error as Record<string, unknown>;
    if (typeof error.message === 'string') {
      return error.message;
    }
  }
  return fallback;
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON must be an object');
  }
  return parsed as Record<string, unknown>;
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const jsonObjectSchema = z
  .string()
  .default('{}')
  .refine((value) => {
    try {
      parseJsonObject(value);
      return true;
    } catch {
      return false;
    }
  }, 'Must be a valid JSON object');

const moneySchema = z.preprocess(
  (value) => (value === '' || value === null ? undefined : value),
  z.coerce.number().nonnegative().max(999999).optional()
);

const intSchema = z.preprocess(
  (value) => (value === '' || value === null ? undefined : value),
  z.coerce.number().int().min(0).max(999999).optional()
);

const quotaValueSchema = z.preprocess(
  (value) => (value === '' || value === null ? undefined : value),
  z.coerce.number().int().min(-1).max(999999).optional()
);

const quotaKeySchema = z
  .string()
  .min(1)
  .max(120)
  .regex(
    /^[a-z0-9-]+\.[a-z0-9._-]+$/i,
    'Key must be in the form ${namespace}.xxx (e.g. platform.credits)'
  );

const quotaItemSchema = z.object({
  key: quotaKeySchema,
  monthly: quotaValueSchema,
  yearly: quotaValueSchema,
});

const capabilityValueSchema = z.union([z.string(), z.boolean()]).optional();
const capabilityItemSchema = z.object({
  key: quotaKeySchema,
  value: capabilityValueSchema,
});

const planFormSchema = z.object({
  name: z.string().min(2).max(100),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/),
  sortOrder: intSchema,
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),

  // Display-only features list (multi-language)
  featuresListZh: z.string().default(''),
  featuresListEn: z.string().default(''),

  currency: z.string().length(3).default('USD'),
  monthly: moneySchema,
  yearly: moneySchema,

  // Machine-enforced capabilities (JSON) + common structured fields
  capabilitiesJson: jsonObjectSchema,
  capabilityValues: z.array(capabilityItemSchema).default([]),

  // Quotas (per-month, split by billing interval)
  quotaItems: z.array(quotaItemSchema).default([]),

  stripeProductId: z.string().optional(),
  syncStripe: z.boolean().default(false),
});

type PlanFormValues = z.infer<typeof planFormSchema>;

interface PlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan?: PlanWithSubscribers | null;
  productId?: string;
  onSuccess?: () => void;
}

export function PlanDialog({ open, onOpenChange, plan, productId, onSuccess }: PlanDialogProps) {
  const { toast } = useToast();
  const locale = useLocale();
  const t = useTranslations('dashboard.entitlements.planDialogV2');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isEditing = !!plan;
  const [slugDirty, setSlugDirty] = useState(false);
  const planCapabilityProductId = plan?.productId ?? productId;
  const planCapabilitiesKey = useMemo(() => {
    if (!open) {
      return null;
    }
    if (!planCapabilityProductId) {
      return API_KEYS.ENTITLEMENTS.PLAN_CAPABILITIES;
    }
    const params = new URLSearchParams({ productId: planCapabilityProductId });
    return `${API_KEYS.ENTITLEMENTS.PLAN_CAPABILITIES}?${params.toString()}`;
  }, [open, planCapabilityProductId]);
  const {
    data: planCapabilitiesData,
    error: planCapabilitiesError,
    isLoading: planCapabilitiesLoading,
  } = useSWR<PlanCapabilitiesResponse>(planCapabilitiesKey, fetcher);
  const planCapabilityDefinitions = useMemo(
    () => planCapabilitiesData?.data ?? [],
    [planCapabilitiesData?.data]
  );

  const defaults = useMemo<PlanFormValues>(() => {
    const pricing = (plan?.pricing as Record<string, unknown> | undefined) || {};
    const monthly = pricing.monthly as number | undefined;
    const yearly = pricing.yearly as number | undefined;

    const limits = (plan?.limits as Record<string, unknown> | undefined) || {};
    const limitsMonthly = (limits.monthly as Record<string, unknown> | undefined) || {};
    const limitsYearly = (limits.yearly as Record<string, unknown> | undefined) || {};

    const langJsonb = (plan?.langJsonb || {}) as Record<
      string,
      Record<string, unknown> | undefined
    >;
    const zh = langJsonb.zh;
    const en = langJsonb.en;
    const featuresListZh = Array.isArray(zh?.featuresList)
      ? (zh?.featuresList as string[]).join('\n')
      : '';
    const featuresListEn = Array.isArray(en?.featuresList)
      ? (en?.featuresList as string[]).join('\n')
      : '';

    const stripe = (plan?.stripe as Record<string, unknown> | undefined) || {};
    const stripeProductId = (stripe.productId as string | undefined) || '';

    const capabilities = (plan?.features as Record<string, unknown> | undefined) || {};
    const allQuotaKeys = Array.from(
      new Set([...Object.keys(limitsMonthly), ...Object.keys(limitsYearly)])
    ).sort();
    const quotaItems = allQuotaKeys.map((key) => ({
      key,
      monthly: typeof limitsMonthly[key] === 'number' ? limitsMonthly[key] : undefined,
      yearly: typeof limitsYearly[key] === 'number' ? limitsYearly[key] : undefined,
    }));

    return {
      name: plan?.name || '',
      slug: plan?.slug || '',
      sortOrder: plan?.sortOrder ?? 0,
      isActive: plan?.isActive ?? true,
      isDefault: plan?.isDefault ?? false,

      featuresListZh,
      featuresListEn,

      currency: 'USD',
      monthly: monthly ?? undefined,
      yearly: yearly ?? undefined,

      capabilitiesJson: JSON.stringify(capabilities, null, 2),
      capabilityValues: [],
      quotaItems,

      stripeProductId,
      syncStripe: false,
    };
  }, [plan]);

  const form = useForm<PlanFormValues>({
    resolver: zodResolver(planFormSchema) as unknown as Resolver<PlanFormValues>,
    defaultValues: defaults,
  });

  const quotaFields = useFieldArray({
    control: form.control,
    name: 'quotaItems',
  });

  useEffect(() => {
    if (open) {
      form.reset(defaults);
      setSlugDirty(false);
    }
  }, [open, defaults, form]);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (planCapabilityDefinitions.length === 0) {
      form.setValue('capabilityValues', [], {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      });
      return;
    }

    let capabilities: Record<string, unknown>;
    try {
      capabilities = parseJsonObject(form.getValues('capabilitiesJson') || '{}');
    } catch {
      capabilities = (plan?.features as Record<string, unknown> | undefined) || {};
    }

    form.setValue(
      'capabilityValues',
      buildCapabilityFormValues(planCapabilityDefinitions, capabilities),
      {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      }
    );
  }, [open, form, plan?.features, planCapabilityDefinitions]);

  const onSubmit = async (values: PlanFormValues) => {
    setIsSubmitting(true);
    try {
      const capabilities = parseJsonObject(values.capabilitiesJson || '{}');
      const capabilityValuesByKey = new Map(
        values.capabilityValues.map((item) => [item.key, item.value] as const)
      );
      const capabilityIssues: string[] = [];

      for (const definition of planCapabilityDefinitions) {
        delete capabilities[definition.key];
        const parsed = parsePlanCapabilityValue(
          definition,
          capabilityValuesByKey.get(definition.key)
        );

        if (!parsed.success) {
          const label = getPlanCapabilityLabel(definition, locale);
          capabilityIssues.push(t(`capabilities.errors.${parsed.issue.code}`, { label }));
          continue;
        }

        if (parsed.value !== undefined) {
          capabilities[definition.key] = parsed.value;
        }
      }

      if (capabilityIssues.length > 0) {
        throw new Error(capabilityIssues.join('; '));
      }

      const monthlyLimits: Record<string, number> = {};
      const yearlyLimits: Record<string, number> = {};
      for (const item of values.quotaItems || []) {
        const key = item.key.trim();
        if (!key) continue;
        if (typeof item.monthly === 'number') monthlyLimits[key] = item.monthly;
        if (typeof item.yearly === 'number') yearlyLimits[key] = item.yearly;
      }

      const langJsonbBase = (isEditing ? plan?.langJsonb || {} : {}) || {};
      const langJsonb: Record<string, unknown> = { ...langJsonbBase };

      const zhLines = values.featuresListZh
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      const enLines = values.featuresListEn
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);

      if (zhLines.length > 0) {
        const prev = (langJsonb.zh as Record<string, unknown> | undefined) || {};
        langJsonb.zh = { ...prev, featuresList: zhLines };
      }
      if (enLines.length > 0) {
        const prev = (langJsonb.en as Record<string, unknown> | undefined) || {};
        langJsonb.en = { ...prev, featuresList: enLines };
      }

      const payload: Record<string, unknown> = {
        name: values.name,
        slug: values.slug,
        sortOrder: values.sortOrder ?? 0,
        isActive: values.isActive,
        isDefault: values.isDefault,
        features: capabilities,
        limits: {
          monthly: monthlyLimits,
          yearly: yearlyLimits,
        },
        langJsonb,
        pricing: {
          currency: 'USD',
          monthly: values.monthly ?? undefined,
          yearly: values.yearly ?? undefined,
        },
        stripe: values.stripeProductId ? { productId: values.stripeProductId } : undefined,
      };

      if (!isEditing && productId) {
        payload.productId = productId;
      }

      const response = await fetch(
        isEditing ? `/api/admin/entitlements/plans/${plan.id}` : '/api/admin/entitlements/plans',
        {
          method: isEditing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );

      const json = (await response.json()) as {
        success?: boolean;
        data?: { id: string };
        error?: string | { message?: string };
      };
      if (!response.ok || !json.success) {
        throw new Error(readApiErrorMessage(json, 'Failed to save plan'));
      }

      const savedPlanId = isEditing ? plan.id : json.data!.id;

      if (values.syncStripe) {
        const syncRes = await fetch(`/api/admin/entitlements/plans/${savedPlanId}/sync-stripe`, {
          method: 'POST',
        });
        const syncJson = (await syncRes.json()) as { success?: boolean; error?: string };
        if (!syncRes.ok || !syncJson.success) {
          throw new Error(readApiErrorMessage(syncJson, 'Saved, but Stripe sync failed'));
        }
      }

      toast({
        title: isEditing ? t('toast.updatedTitle') : t('toast.createdTitle'),
        description: values.syncStripe ? t('toast.savedAndSynced') : t('toast.saved'),
      });

      onOpenChange(false);
      onSuccess?.();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : t('toast.saveFailed');
      toast({
        title: t('toast.errorTitle'),
        description: message,
        variant: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? t('title.edit') : t('title.create')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <Tabs defaultValue="basic" className="w-full">
              <TabsList className="grid w-full grid-cols-6">
                <TabsTrigger value="basic">{t('tabs.basic')}</TabsTrigger>
                <TabsTrigger value="display">{t('tabs.display')}</TabsTrigger>
                <TabsTrigger value="pricing">{t('tabs.pricing')}</TabsTrigger>
                <TabsTrigger value="limits">{t('tabs.limits')}</TabsTrigger>
                <TabsTrigger value="capabilities">{t('tabs.capabilities')}</TabsTrigger>
                <TabsTrigger value="stripe">{t('tabs.stripe')}</TabsTrigger>
              </TabsList>

              <TabsContent value="basic" className="space-y-4 mt-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('fields.name.label')}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={t('fields.name.placeholder')}
                          aria-label={t('fields.name.label')}
                          {...field}
                          onChange={(e) => {
                            const next = e.target.value;
                            field.onChange(next);
                            if (!slugDirty && !form.getValues('slug')) {
                              form.setValue('slug', toSlug(next), { shouldValidate: true });
                            }
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="slug"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('fields.slug.label')}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={t('fields.slug.placeholder')}
                          aria-label={t('fields.slug.label')}
                          {...field}
                          onChange={(e) => {
                            setSlugDirty(true);
                            field.onChange(e.target.value);
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="sortOrder"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('fields.sortOrder.label')}</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder={t('fields.sortOrder.placeholder')}
                          aria-label={t('fields.sortOrder.label')}
                          value={field.value ?? ''}
                          onChange={(e) =>
                            field.onChange(
                              e.target.value === '' ? undefined : Number(e.target.value)
                            )
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="isActive"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between rounded-lg border p-4">
                        <FormLabel className="mb-0">{t('fields.isActive.label')}</FormLabel>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="isDefault"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between rounded-lg border p-4">
                        <FormLabel className="mb-0">{t('fields.isDefault.label')}</FormLabel>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              </TabsContent>

              <TabsContent value="display" className="space-y-4 mt-4">
                <div className="text-sm text-muted-foreground">{t('display.help')}</div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="featuresListZh"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('display.featuresListZh.label')}</FormLabel>
                        <FormControl>
                          <Textarea
                            rows={10}
                            placeholder={t('display.featuresListZh.placeholder')}
                            aria-label={t('display.featuresListZh.label')}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="featuresListEn"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('display.featuresListEn.label')}</FormLabel>
                        <FormControl>
                          <Textarea
                            rows={10}
                            placeholder={t('display.featuresListEn.placeholder')}
                            aria-label={t('display.featuresListEn.label')}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </TabsContent>

              <TabsContent value="pricing" className="space-y-4 mt-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="monthly"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('pricing.monthlyPrice.label')}</FormLabel>
                        <FormControl>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground">$</span>
                            <Input
                              type="number"
                              step="0.01"
                              placeholder={t('pricing.monthlyPrice.placeholder')}
                              aria-label={t('pricing.monthlyPrice.label')}
                              value={field.value ?? ''}
                              onChange={(e) =>
                                field.onChange(
                                  e.target.value === '' ? undefined : Number(e.target.value)
                                )
                              }
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="yearly"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('pricing.yearlyPrice.label')}</FormLabel>
                        <FormControl>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground">$</span>
                            <Input
                              type="number"
                              step="0.01"
                              placeholder={t('pricing.yearlyPrice.placeholder')}
                              aria-label={t('pricing.yearlyPrice.label')}
                              value={field.value ?? ''}
                              onChange={(e) =>
                                field.onChange(
                                  e.target.value === '' ? undefined : Number(e.target.value)
                                )
                              }
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </TabsContent>

              <TabsContent value="limits" className="space-y-4 mt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{t('limits.title')}</div>
                    <div className="text-sm text-muted-foreground">{t('limits.help')}</div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      quotaFields.append({
                        key: PLATFORM_PRIMARY_CREDIT_METRIC,
                        monthly: 0,
                        yearly: 0,
                      })
                    }
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    {t('limits.add')}
                  </Button>
                </div>

                {quotaFields.fields.length === 0 ? (
                  <div className="text-sm text-muted-foreground rounded-lg border p-4">
                    {t('limits.empty')}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {quotaFields.fields.map((row, index) => (
                      <div key={row.id} className="grid grid-cols-12 gap-2 items-end">
                        <FormField
                          control={form.control}
                          name={`quotaItems.${index}.key`}
                          render={({ field }) => (
                            <FormItem className="col-span-6">
                              <FormLabel className={index === 0 ? '' : 'sr-only'}>
                                {t('limits.headers.key')}
                              </FormLabel>
                              <FormControl>
                                <Input
                                  placeholder={t('limits.headers.keyPlaceholder')}
                                  aria-label={t('limits.headers.key')}
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`quotaItems.${index}.monthly`}
                          render={({ field }) => (
                            <FormItem className="col-span-2">
                              <FormLabel className={index === 0 ? '' : 'sr-only'}>
                                {t('limits.headers.monthly')}
                              </FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  placeholder={t('limits.headers.valuePlaceholder')}
                                  aria-label={t('limits.headers.monthly')}
                                  value={field.value ?? ''}
                                  onChange={(e) =>
                                    field.onChange(
                                      e.target.value === '' ? undefined : Number(e.target.value)
                                    )
                                  }
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`quotaItems.${index}.yearly`}
                          render={({ field }) => (
                            <FormItem className="col-span-2">
                              <FormLabel className={index === 0 ? '' : 'sr-only'}>
                                {t('limits.headers.yearly')}
                              </FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  placeholder={t('limits.headers.valuePlaceholder')}
                                  aria-label={t('limits.headers.yearly')}
                                  value={field.value ?? ''}
                                  onChange={(e) =>
                                    field.onChange(
                                      e.target.value === '' ? undefined : Number(e.target.value)
                                    )
                                  }
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <div className="col-span-2 flex justify-end">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => quotaFields.remove(index)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="capabilities" className="space-y-4 mt-4">
                <div className="space-y-3 rounded-lg border p-4">
                  <div>
                    <div className="font-medium">{t('capabilities.schema.title')}</div>
                    <div className="text-sm text-muted-foreground">
                      {t('capabilities.schema.help')}
                    </div>
                  </div>

                  {planCapabilitiesLoading ? (
                    <div className="text-sm text-muted-foreground">
                      {t('capabilities.schema.loading')}
                    </div>
                  ) : planCapabilitiesError ? (
                    <div className="text-sm text-destructive">
                      {t('capabilities.schema.loadFailed')}
                    </div>
                  ) : planCapabilityDefinitions.length === 0 ? (
                    <div className="text-sm text-muted-foreground">
                      {t('capabilities.schema.empty')}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {planCapabilityDefinitions.map((definition, index) => {
                        const label = getPlanCapabilityLabel(definition, locale);
                        const description = getLocalizedPlanCapabilityText(
                          definition.description,
                          locale
                        );

                        if (definition.valueType === 'boolean') {
                          return (
                            <FormField
                              key={definition.key}
                              control={form.control}
                              name={`capabilityValues.${index}.value`}
                              render={({ field }) => (
                                <FormItem className="flex items-center justify-between rounded-lg border p-3">
                                  <div className="min-w-0 space-y-1">
                                    <FormLabel className="mb-0">
                                      {label}
                                      {definition.required && (
                                        <span className="ml-2 text-xs text-muted-foreground">
                                          {t('capabilities.schema.required')}
                                        </span>
                                      )}
                                    </FormLabel>
                                    {description && (
                                      <div className="text-sm text-muted-foreground">
                                        {description}
                                      </div>
                                    )}
                                  </div>
                                  <FormControl>
                                    <Switch
                                      checked={field.value === true}
                                      onCheckedChange={field.onChange}
                                    />
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                          );
                        }

                        return (
                          <FormField
                            key={definition.key}
                            control={form.control}
                            name={`capabilityValues.${index}.value`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>
                                  {label}
                                  {definition.required && (
                                    <span className="ml-2 text-xs text-muted-foreground">
                                      {t('capabilities.schema.required')}
                                    </span>
                                  )}
                                </FormLabel>
                                <FormControl>
                                  {definition.valueType === 'enum' ? (
                                    <Select
                                      value={typeof field.value === 'string' ? field.value : ''}
                                      onValueChange={field.onChange}
                                    >
                                      <SelectTrigger>
                                        <SelectValue
                                          placeholder={t('capabilities.schema.selectPlaceholder')}
                                        />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {(definition.options ?? []).map((option) => (
                                          <SelectItem
                                            key={String(option.value)}
                                            value={String(option.value)}
                                          >
                                            {getPlanCapabilityOptionLabel(option, locale)}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  ) : (
                                    <Input
                                      type={definition.valueType === 'number' ? 'number' : 'text'}
                                      value={
                                        typeof field.value === 'boolean' ||
                                        field.value === undefined
                                          ? ''
                                          : field.value
                                      }
                                      onChange={(event) => field.onChange(event.target.value)}
                                    />
                                  )}
                                </FormControl>
                                {description && (
                                  <div className="text-sm text-muted-foreground">{description}</div>
                                )}
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>

                <FormField
                  control={form.control}
                  name="capabilitiesJson"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('capabilities.json.label')}</FormLabel>
                      <div className="text-sm text-muted-foreground">
                        {t('capabilities.json.help')}
                      </div>
                      <FormControl>
                        <Textarea rows={14} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </TabsContent>

              <TabsContent value="stripe" className="space-y-4 mt-4">
                <FormField
                  control={form.control}
                  name="stripeProductId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('stripe.productId.label')}</FormLabel>
                      <FormControl>
                        <Input placeholder={t('stripe.productId.placeholder')} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="syncStripe"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-4">
                      <div>
                        <FormLabel className="mb-0">{t('stripe.sync.label')}</FormLabel>
                        <div className="text-sm text-muted-foreground">{t('stripe.sync.help')}</div>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </TabsContent>
            </Tabs>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('actions.cancel')}
              </Button>
              <Button type="submit" disabled={isSubmitting || planCapabilitiesLoading}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isEditing ? t('actions.update') : t('actions.create')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
