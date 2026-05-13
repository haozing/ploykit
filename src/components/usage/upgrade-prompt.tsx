'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEntitlement } from '@/hooks/use-entitlement';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/_core/utils';

interface UpgradePromptProps {
  userId: string;
  feature?: string;
  message?: string;
  showPlans?: boolean;
  className?: string;
}

/**
 * Simple upgrade prompt banner
 */
export function UpgradePrompt({
  userId,
  feature,
  message,
  showPlans = false,
  className,
}: UpgradePromptProps) {
  const t = useTranslations('components.usage.upgradePrompt');
  const { plan, planId } = useEntitlement(userId);

  const defaultMessage = feature ? t('featureNotAvailable', { feature }) : t('upgradeToUnlock');

  return (
    <div
      className={cn(
        'rounded-lg border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-6',
        className
      )}
    >
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div className="flex-shrink-0">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500">
            <svg
              className="h-6 w-6 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-foreground">{t('title')}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{message || defaultMessage}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('currentPlan')}: <span className="font-medium">{plan || t('plans.free')}</span>
          </p>

          {/* Actions */}
          <div className="mt-4 flex items-center gap-3">
            <Button asChild>
              <Link href="/billing/upgrade">{t('actions.viewPlans')}</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/billing">{t('actions.manageSubscription')}</Link>
            </Button>
          </div>

          {/* Plans comparison (optional) */}
          {showPlans && (
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <PlanCard
                name={t('plans.free')}
                price="$0"
                features={[
                  t('plans.features.fiveUsers'),
                  t('plans.features.oneHundredMBStorage'),
                  t('plans.features.threePlugins'),
                ]}
                current={planId === 'free'}
              />
              <PlanCard
                name={t('plans.pro')}
                price="$49"
                features={[
                  t('plans.features.fiftyUsers'),
                  t('plans.features.oneGBStorage'),
                  t('plans.features.twentyPlugins'),
                ]}
                popular
                current={planId === 'pro'}
              />
              <PlanCard
                name={t('plans.enterprise')}
                price="$299"
                features={[
                  t('plans.features.unlimitedUsers'),
                  t('plans.features.tenGBStorage'),
                  t('plans.features.unlimitedPlugins'),
                ]}
                current={planId === 'enterprise'}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface PlanCardProps {
  name: string;
  price: string;
  features: string[];
  popular?: boolean;
  current?: boolean;
}

function PlanCard({ name, price, features, popular, current }: PlanCardProps) {
  const t = useTranslations('components.usage.upgradePrompt');

  return (
    <div
      className={cn(
        'relative rounded-lg border bg-card p-4',
        popular && 'border-primary shadow-md',
        current && 'border-success bg-success-50'
      )}
    >
      {popular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="inline-flex rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
            {t('badges.popular')}
          </span>
        </div>
      )}
      {current && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="inline-flex rounded-full bg-success px-3 py-1 text-xs font-semibold text-white">
            {t('badges.current')}
          </span>
        </div>
      )}
      <div className="text-center">
        <h4 className="font-semibold">{name}</h4>
        <div className="mt-2 text-2xl font-bold">
          {price}
          <span className="text-sm font-normal text-muted-foreground">{t('perMonth')}</span>
        </div>
        <ul className="mt-4 space-y-2 text-left text-sm text-muted-foreground">
          {features.map((feature, index) => (
            <li key={index} className="flex items-start gap-2">
              <svg
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-success"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
              {feature}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * Upgrade dialog modal
 */
interface UpgradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  feature?: string;
  message?: string;
}

export function UpgradeDialog({
  open,
  onOpenChange,
  userId,
  feature,
  message,
}: UpgradeDialogProps) {
  const t = useTranslations('components.usage.upgradePrompt.dialog');
  const { plan } = useEntitlement(userId);

  const defaultMessage = feature
    ? t('featureRequiresUpgrade', { feature })
    : t('upgradeToUnlockFeatures');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500">
              <svg
                className="h-5 w-5 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </div>
            {t('title')}
          </DialogTitle>
          <DialogDescription>{message || defaultMessage}</DialogDescription>
        </DialogHeader>

        {/* Current plan */}
        <div className="rounded-lg bg-muted p-4">
          <div className="text-sm font-medium text-muted-foreground">{t('currentPlan')}</div>
          <div className="mt-1 text-lg font-semibold">{plan || t('plans.free')}</div>
        </div>

        {/* Available plans */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border p-4">
            <h4 className="font-semibold">{t('plans.free')}</h4>
            <div className="mt-2 text-2xl font-bold">
              $0<span className="text-sm font-normal">{t('perMonth')}</span>
            </div>
            <ul className="mt-4 space-y-2 text-sm">
              <li>• {t('plans.features.fiveUsers')}</li>
              <li>• {t('plans.features.oneHundredMBStorage')}</li>
              <li>• {t('plans.features.threePlugins')}</li>
              <li>• {t('plans.features.tenKApiCalls')}</li>
            </ul>
          </div>

          <div className="rounded-lg border-2 border-primary p-4 shadow-md">
            <div className="mb-2 text-xs font-semibold text-primary">{t('recommended')}</div>
            <h4 className="font-semibold">{t('plans.pro')}</h4>
            <div className="mt-2 text-2xl font-bold">
              $49<span className="text-sm font-normal">{t('perMonth')}</span>
            </div>
            <ul className="mt-4 space-y-2 text-sm">
              <li>• {t('plans.features.fiftyUsers')}</li>
              <li>• {t('plans.features.oneGBStorage')}</li>
              <li>• {t('plans.features.twentyPlugins')}</li>
              <li>• {t('plans.features.oneMApiCalls')}</li>
              <li>• {t('plans.features.prioritySupport')}</li>
            </ul>
            <Button className="mt-4 w-full" asChild>
              <Link href="/billing/upgrade?plan=pro">{t('actions.upgradeToPro')}</Link>
            </Button>
          </div>

          <div className="rounded-lg border p-4">
            <h4 className="font-semibold">{t('plans.enterprise')}</h4>
            <div className="mt-2 text-2xl font-bold">
              $299<span className="text-sm font-normal">{t('perMonth')}</span>
            </div>
            <ul className="mt-4 space-y-2 text-sm">
              <li>• {t('plans.features.unlimitedUsers')}</li>
              <li>• {t('plans.features.tenGBStorage')}</li>
              <li>• {t('plans.features.unlimitedPlugins')}</li>
              <li>• {t('plans.features.tenMApiCalls')}</li>
              <li>• {t('plans.features.ssoSaml')}</li>
              <li>• {t('plans.features.whiteLabel')}</li>
            </ul>
            <Button variant="outline" className="mt-4 w-full" asChild>
              <Link href="/billing/upgrade?plan=enterprise">{t('actions.upgrade')}</Link>
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('actions.maybeLater')}
          </Button>
          <Button asChild>
            <Link href="/billing/upgrade">{t('actions.viewAllPlans')}</Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
