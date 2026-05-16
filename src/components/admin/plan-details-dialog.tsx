'use client';

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent } from '@/components/ui/card';
import { Edit, CheckCircle, XCircle, Star } from 'lucide-react';
import type { EntitlementPlan as Plan } from '@/lib/db/schema';
import {
  formatBillingMetricName,
  formatCapabilityKey,
  getBillingMetricUnit,
} from '@/lib/billing/billing-metrics';

/**
 * Plan Details Dialog
 *
 * Display comprehensive plan information in a modal
 * Features:
 * - All plan details in organized sections
 * - Feature list with enabled/disabled status
 * - Limit display with unlimited indicators
 * - Pricing information
 * - Quick edit button
 */

interface PlanDetailsDialogProps {
  plan: Plan | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit?: () => void;
}

export function PlanDetailsDialog({ plan, open, onOpenChange, onEdit }: PlanDetailsDialogProps) {
  if (!plan) return null;

  const enabledFeatures = Object.entries(plan.features).filter(([_, enabled]) => enabled);
  const disabledFeatures = Object.entries(plan.features).filter(([_, enabled]) => !enabled);
  const langJsonb = (plan.langJsonb as Record<string, unknown> | null | undefined) || {};
  const description =
    ((langJsonb.en as Record<string, unknown> | undefined)?.description as string | undefined) ||
    ((langJsonb.zh as Record<string, unknown> | undefined)?.description as string | undefined) ||
    '';
  const pricing = (plan.pricing || {}) as { currency?: string; monthly?: number; yearly?: number };
  const formatPrice = (amount: number | undefined, interval: 'monthly' | 'yearly') => {
    if (!amount) return 'Free';
    const formatted = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: pricing.currency || 'USD',
      minimumFractionDigits: 0,
    }).format(amount);
    return `${formatted}/${interval === 'monthly' ? 'mo' : 'yr'}`;
  };
  const limitGroups = [
    { label: 'Monthly', limits: plan.limits.monthly || {} },
    { label: 'Yearly', limits: plan.limits.yearly || {} },
  ];
  const hasLimits = limitGroups.some((group) => Object.keys(group.limits).length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {plan.name}
            {plan.isDefault && (
              <Badge variant="secondary">
                <Star className="h-3 w-3 mr-1" />
                Default
              </Badge>
            )}
            <Badge variant={plan.isActive ? 'default' : 'secondary'}>
              {plan.isActive ? 'Active' : 'Inactive'}
            </Badge>
          </DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="space-y-6">
          {/* Pricing Section */}
          <div>
            <h3 className="text-sm font-semibold mb-3">Pricing</h3>
            <Card>
              <CardContent className="pt-6">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Monthly</div>
                    <div className="text-2xl font-bold">
                      {formatPrice(pricing.monthly, 'monthly')}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Yearly</div>
                    <div className="text-2xl font-bold">
                      {formatPrice(pricing.yearly, 'yearly')}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Features Section */}
          <div>
            <h3 className="text-sm font-semibold mb-3">Features</h3>
            <Card>
              <CardContent className="pt-6">
                <div className="space-y-4">
                  {/* Enabled Features */}
                  {enabledFeatures.length > 0 && (
                    <div>
                      <div className="text-sm font-medium text-success mb-2">
                        Included ({enabledFeatures.length})
                      </div>
                      <div className="space-y-2">
                        {enabledFeatures.map(([key]) => (
                          <div key={key} className="flex items-center gap-2 text-sm">
                            <CheckCircle className="h-4 w-4 text-success" />
                            <span>{formatFeatureName(key)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Disabled Features */}
                  {disabledFeatures.length > 0 && enabledFeatures.length > 0 && <Separator />}

                  {disabledFeatures.length > 0 && (
                    <div>
                      <div className="text-sm font-medium text-muted-foreground mb-2">
                        Not Included ({disabledFeatures.length})
                      </div>
                      <div className="space-y-2">
                        {disabledFeatures.map(([key]) => (
                          <div
                            key={key}
                            className="flex items-center gap-2 text-sm text-muted-foreground"
                          >
                            <XCircle className="h-4 w-4" />
                            <span>{formatFeatureName(key)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {enabledFeatures.length === 0 && disabledFeatures.length === 0 && (
                    <div className="text-sm text-muted-foreground text-center py-4">
                      No features configured
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Limits Section */}
          <div>
            <h3 className="text-sm font-semibold mb-3">Usage Limits</h3>
            <Card>
              <CardContent className="pt-6">
                {hasLimits ? (
                  <div className="space-y-6">
                    {limitGroups.map((group) => {
                      const entries = Object.entries(group.limits);
                      if (entries.length === 0) return null;
                      return (
                        <div key={group.label}>
                          <div className="mb-3 text-sm font-medium">{group.label}</div>
                          <div className="grid grid-cols-2 gap-4">
                            {entries.map(([key, value]) => (
                              <div key={`${group.label}:${key}`}>
                                <div className="text-sm text-muted-foreground mb-1">
                                  {formatLimitName(key)}
                                </div>
                                <div className="text-lg font-semibold">
                                  {value === -1 ? (
                                    <span className="text-success">Unlimited</span>
                                  ) : (
                                    <>
                                      {value.toLocaleString()}
                                      <span className="text-sm font-normal text-muted-foreground ml-1">
                                        {getLimitUnit(key)}
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground text-center py-4">
                    No limits configured
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Metadata Section */}
          <div>
            <h3 className="text-sm font-semibold mb-3">Additional Information</h3>
            <Card>
              <CardContent className="pt-6">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Sort Order:</span>
                    <span className="ml-2 font-medium">{plan.sortOrder}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Status:</span>
                    <span className="ml-2 font-medium">
                      {plan.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Default Plan:</span>
                    <span className="ml-2 font-medium">{plan.isDefault ? 'Yes' : 'No'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Created:</span>
                    <span className="ml-2 font-medium">
                      {new Date(plan.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Updated:</span>
                    <span className="ml-2 font-medium">
                      {new Date(plan.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {onEdit && (
            <Button onClick={onEdit}>
              <Edit className="h-4 w-4 mr-2" />
              Edit Plan
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Helper functions
 */
function formatFeatureName(key: string): string {
  return formatCapabilityKey(key);
}

function formatLimitName(key: string): string {
  return formatBillingMetricName(key);
}

function getLimitUnit(key: string): string {
  return getBillingMetricUnit(key);
}
