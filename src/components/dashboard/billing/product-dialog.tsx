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
import { Textarea } from '@/components/ui/textarea';
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
import type { Product } from '@/hooks/use-billing';
import { useTranslations } from 'next-intl';

type Translator = ReturnType<typeof useTranslations>;

const buildProductFormSchema = (t: Translator) =>
  z.object({
    name: z.string().min(1, t('errors.nameRequired')).max(100, t('errors.max100')),
    slug: z
      .string()
      .min(1, t('errors.slugRequired'))
      .max(100, t('errors.max100'))
      .regex(/^[a-z0-9-]+$/, t('errors.slugFormat')),
    description: z.string().max(500, t('errors.max500')).optional(),
    category: z.string().optional(),
    isActive: z.boolean(),
    sortOrder: z.number().min(0, t('errors.sortOrderNonNegative')),
  });

type ProductFormValues = z.infer<ReturnType<typeof buildProductFormSchema>>;

interface ProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product?: Product | null;
  onSuccess?: () => void;
}

export function ProductDialog({ open, onOpenChange, product, onSuccess }: ProductDialogProps) {
  const t = useTranslations('dashboard.revenue.productDialog');
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isEditing = !!product;

  const productFormSchema = useMemo(() => buildProductFormSchema(t), [t]);

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: {
      name: '',
      slug: '',
      description: '',
      category: 'saas',
      isActive: true,
      sortOrder: 0,
    },
  });

  useEffect(() => {
    if (product && open) {
      form.reset({
        name: product.name,
        slug: product.slug,
        description: product.description || '',
        category: product.category || 'saas',
        isActive: product.isActive,
        sortOrder: product.sortOrder,
      });
    } else if (!open) {
      form.reset();
    }
  }, [product, open, form]);

  const onSubmit = async (data: ProductFormValues) => {
    setIsSubmitting(true);

    try {
      const response = await fetch(
        isEditing ? `/api/billing/products/${product.id}` : '/api/billing/products',
        {
          method: isEditing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
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
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t(isEditing ? 'titleEdit' : 'titleCreate')}</DialogTitle>
          <DialogDescription>
            {t(isEditing ? 'descriptionEdit' : 'descriptionCreate')}
          </DialogDescription>
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
                  <FormDescription>{t('fields.slug.help')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.description.label')}</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder={t('fields.description.placeholder')}
                      className="resize-none"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('fields.category.label')}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t('fields.category.placeholder')} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="saas">{t('fields.category.options.saas')}</SelectItem>
                        <SelectItem value="addon">{t('fields.category.options.addon')}</SelectItem>
                        <SelectItem value="service">
                          {t('fields.category.options.service')}
                        </SelectItem>
                        <SelectItem value="other">{t('fields.category.options.other')}</SelectItem>
                      </SelectContent>
                    </Select>
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
                        {...field}
                        onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                      />
                    </FormControl>
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
