'use client';

import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Product, SKUWithDetails } from '@/hooks/use-billing';
import { useTranslations } from 'next-intl';

type Translator = ReturnType<typeof useTranslations>;

const buildSkuFormSchema = (t: Translator) =>
  z.object({
    name: z.string().min(1, t('errors.nameRequired')).max(100, t('errors.max100')),
    slug: z.string().min(1, t('errors.slugRequired')).max(100, t('errors.max100')),
    productId: z.string().min(1, t('errors.productRequired')),
    planId: z.string().min(1, t('errors.planRequired')),
    price: z.string().min(1, t('errors.priceRequired')),
    currency: z.string(),
    billingInterval: z.string().optional(),
    isActive: z.boolean(),
  });

type SKUFormValues = z.infer<ReturnType<typeof buildSkuFormSchema>>;

interface SKUDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sku?: SKUWithDetails | null;
  products: Product[];
  onSuccess?: () => void;
}

interface Plan {
  id: string;
  name: string;
}

export function SKUDialog({ open, onOpenChange, sku, products, onSuccess }: SKUDialogProps) {
  const t = useTranslations('dashboard.revenue.skuDialog');
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const isEditing = !!sku;

  const skuFormSchema = useMemo(() => buildSkuFormSchema(t), [t]);

  const form = useForm<SKUFormValues>({
    resolver: zodResolver(skuFormSchema),
    defaultValues: {
      name: '',
      slug: '',
      productId: '',
      planId: '',
      price: '0',
      currency: 'USD',
      billingInterval: 'monthly',
      isActive: true,
    },
  });

  // Fetch plans when dialog opens so we have the latest list
  useEffect(() => {
    const fetchPlans = async () => {
      setPlansLoading(true);
      try {
        const response = await fetch('/api/admin/entitlements/plans');
        if (response.ok) {
          const data = await response.json();
          setPlans(data.plans || []);
        }
      } catch (error) {
        console.error('Error fetching plans:', error);
      } finally {
        setPlansLoading(false);
      }
    };

    if (open) {
      void fetchPlans();
    }
  }, [open]);

  useEffect(() => {
    if (sku && open) {
      form.reset({
        name: sku.name,
        slug: sku.slug,
        productId: sku.productId,
        planId: sku.planId,
        price: sku.price,
        currency: 'USD',
        billingInterval: sku.billingInterval || '',
        isActive: sku.isActive,
      });
    } else if (!open) {
      form.reset();
    }
  }, [sku, open, form]);

  const onSubmit = async (data: SKUFormValues) => {
    setIsSubmitting(true);

    try {
      const response = await fetch(
        isEditing ? `/api/billing/skus/${sku.id}` : '/api/billing/skus',
        {
          method: isEditing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...data, currency: 'USD' }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || t('errors.saveFailed'));
      }

      toast({
        title: t(isEditing ? 'toast.updateTitle' : 'toast.createTitle'),
        description: t(isEditing ? 'toast.updateDescription' : 'toast.createDescription', {
          name: data.name,
        }),
      });

      onOpenChange(false);
      onSuccess?.();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : t('errors.generic');
      toast({
        title: t('toast.error'),
        description: message,
        variant: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t(isEditing ? 'titleEdit' : 'titleCreate')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.name.label')}</FormLabel>
                  <FormControl>
                    <Input placeholder={t('fields.name.placeholder')} {...field} />
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
                    <Input placeholder={t('fields.slug.placeholder')} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="productId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('fields.product.label')}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t('fields.product.placeholder')} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {products.map((product) => (
                          <SelectItem key={product.id} value={product.id}>
                            {product.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="planId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('fields.plan.label')}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t('fields.plan.placeholder')} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {plansLoading ? (
                          <SelectItem value="loading" disabled>
                            {t('fields.plan.loading')}
                          </SelectItem>
                        ) : (
                          plans.map((plan) => (
                            <SelectItem key={plan.id} value={plan.id}>
                              {plan.name}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    <FormDescription>{t('fields.plan.help')}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="price"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('fields.price.label')}</FormLabel>
                    <FormControl>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">$</span>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder={t('fields.price.placeholder')}
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="billingInterval"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('fields.interval.label')}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="monthly">
                          {t('fields.interval.options.monthly')}
                        </SelectItem>
                        <SelectItem value="yearly">
                          {t('fields.interval.options.yearly')}
                        </SelectItem>
                        <SelectItem value="lifetime">
                          {t('fields.interval.options.lifetime')}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">{t('fields.isActive.label')}</FormLabel>
                    <FormDescription>{t('fields.isActive.hint')}</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                {t('actions.cancel')}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t(isEditing ? 'actions.update' : 'actions.create')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
