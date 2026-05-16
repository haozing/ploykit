'use client';

import { useEffect, useMemo, useState } from 'react';
import { useForm, useFieldArray, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useTranslations } from 'next-intl';
import { useToast } from '@/hooks/use-toast';
import type { PlanWithSubscribers } from '@/hooks/use-entitlements';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Plus, Trash2 } from 'lucide-react';

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
    'Key must be in the form ${namespace}.xxx (e.g. runlynk.calls)'
  );

const quotaItemSchema = z.object({
  key: quotaKeySchema,
  monthly: quotaValueSchema,
  yearly: quotaValueSchema,
});

const resolutionSchema = z.enum(['480p', '720p', '1080p', '4k', 'original']);

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
  runlynkOutputResolution: z.preprocess(
    (value) => (value === '' || value === null ? undefined : value),
    resolutionSchema.optional()
  ),

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
  onSuccess?: () => void;
}

export function PlanDialog({ open, onOpenChange, plan, onSuccess }: PlanDialogProps) {
  const { toast } = useToast();
  const t = useTranslations('dashboard.entitlements.planDialogV2');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isEditing = !!plan;
  const [slugDirty, setSlugDirty] = useState(false);

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
    const runlynkOutputResolution =
      (capabilities['runlynk.outputResolution'] as string | undefined) ||
      (capabilities.outputResolution as string | undefined) ||
      undefined;
    const parsedResolution = resolutionSchema.safeParse(runlynkOutputResolution);

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
      runlynkOutputResolution: parsedResolution.success ? parsedResolution.data : undefined,
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

  const onSubmit = async (values: PlanFormValues) => {
    setIsSubmitting(true);
    try {
      const capabilities = parseJsonObject(values.capabilitiesJson || '{}');

      if (values.runlynkOutputResolution) {
        capabilities['runlynk.outputResolution'] = values.runlynkOutputResolution;
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
        error?: string;
      };
      if (!response.ok || !json.success) {
        throw new Error(json.error || 'Failed to save plan');
      }

      const savedPlanId = isEditing ? plan.id : json.data!.id;

      if (values.syncStripe) {
        const syncRes = await fetch(`/api/admin/entitlements/plans/${savedPlanId}/sync-stripe`, {
          method: 'POST',
        });
        const syncJson = (await syncRes.json()) as { success?: boolean; error?: string };
        if (!syncRes.ok || !syncJson.success) {
          throw new Error(syncJson.error || 'Saved, but Stripe sync failed');
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
                      quotaFields.append({ key: 'runlynk.calls', monthly: 0, yearly: 0 })
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
                <FormField
                  control={form.control}
                  name="runlynkOutputResolution"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('capabilities.outputResolution.label')}</FormLabel>
                      <FormControl>
                        <Select value={field.value ?? ''} onValueChange={field.onChange}>
                          <SelectTrigger>
                            <SelectValue
                              placeholder={t('capabilities.outputResolution.placeholder')}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="480p">480p</SelectItem>
                            <SelectItem value="720p">720p</SelectItem>
                            <SelectItem value="1080p">1080p</SelectItem>
                            <SelectItem value="4k">4k</SelectItem>
                            <SelectItem value="original">original</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="capabilitiesJson"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('capabilities.json.label')}</FormLabel>
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
              <Button type="submit" disabled={isSubmitting}>
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
