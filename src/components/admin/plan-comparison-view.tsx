'use client';

import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, XCircle, Star, Crown } from 'lucide-react';
import type { EntitlementPlan as Plan } from '@/lib/db/schema';

/**
 * Plan Comparison View
 *
 * Side-by-side comparison of all plans
 * Features:
 * - Visual comparison table
 * - Feature availability matrix
 * - Limit comparison
 * - Pricing comparison
 * - Highlight default and popular plans
 */

interface PlanComparisonViewProps {
  plans: Plan[];
  loading?: boolean;
}

export function PlanComparisonView({ plans, loading }: PlanComparisonViewProps) {
  if (loading) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="flex items-center justify-center">
            <div className="text-muted-foreground">Loading plans...</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (plans.length === 0) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center">
            <Crown className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Plans Available</h3>
            <p className="text-sm text-muted-foreground">
              Create your first plan to see the comparison view
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Sort plans by sort order
  const sortedPlans = [...plans].sort((a, b) => a.sortOrder - b.sortOrder);

  const getDescription = (plan: Plan) => {
    const langJsonb = (plan.langJsonb as Record<string, unknown> | null | undefined) || {};
    return (
      ((langJsonb.en as Record<string, unknown> | undefined)?.description as string | undefined) ||
      ((langJsonb.zh as Record<string, unknown> | undefined)?.description as string | undefined) ||
      ((langJsonb['zh-CN'] as Record<string, unknown> | undefined)?.description as
        | string
        | undefined) ||
      ''
    );
  };

  // Get all unique features
  const allFeatures = Array.from(
    new Set(sortedPlans.flatMap((plan) => Object.keys(plan.features)))
  );

  // Get all unique limits
  const allLimits = Array.from(
    new Set(
      sortedPlans.flatMap((plan) => [
        ...Object.keys(plan.limits.monthly || {}),
        ...Object.keys(plan.limits.yearly || {}),
      ])
    )
  );

  const formatPrice = (plan: Plan, interval: 'monthly' | 'yearly') => {
    const pricing = (plan.pricing || {}) as {
      currency?: string;
      monthly?: number;
      yearly?: number;
    };
    const amount = pricing[interval] ?? 0;
    if (!amount) return 'Free';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: pricing.currency || 'USD',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plan Comparison</CardTitle>
        <CardDescription>Compare features and limits across all plans</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="text-left p-4 border-b font-semibold sticky left-0 bg-background z-10">
                  {/* Empty cell for feature names */}
                </th>
                {sortedPlans.map((plan) => (
                  <th key={plan.id} className="p-4 border-b min-w-[200px]">
                    <div className="space-y-2">
                      <div className="flex items-center justify-center gap-2">
                        <span className="font-semibold text-lg">{plan.name}</span>
                        {plan.isDefault && (
                          <Badge variant="secondary" className="text-xs">
                            <Star className="h-3 w-3 mr-1" />
                            Default
                          </Badge>
                        )}
                      </div>
                      {getDescription(plan) && (
                        <div className="text-sm text-muted-foreground">{getDescription(plan)}</div>
                      )}
                      <Badge variant={plan.isActive ? 'default' : 'secondary'}>
                        {plan.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {/* Pricing Section */}
              <tr className="bg-muted/50">
                <td
                  colSpan={sortedPlans.length + 1}
                  className="p-4 font-semibold text-sm sticky left-0 bg-muted/50 z-10"
                >
                  Pricing
                </td>
              </tr>

              <tr>
                <td className="p-4 border-b text-sm text-muted-foreground sticky left-0 bg-background z-10">
                  Price
                </td>
                {sortedPlans.map((plan) => (
                  <td key={plan.id} className="p-4 border-b text-center">
                    <div>
                      <div className="font-semibold">{formatPrice(plan, 'monthly')}</div>
                      <div className="text-xs text-muted-foreground">monthly</div>
                      <div className="mt-2 font-semibold">{formatPrice(plan, 'yearly')}</div>
                      <div className="text-xs text-muted-foreground">yearly</div>
                    </div>
                  </td>
                ))}
              </tr>

              {/* Features Section */}
              <tr className="bg-muted/50">
                <td
                  colSpan={sortedPlans.length + 1}
                  className="p-4 font-semibold text-sm sticky left-0 bg-muted/50 z-10"
                >
                  Features
                </td>
              </tr>

              {allFeatures.map((feature) => (
                <tr key={feature}>
                  <td className="p-4 border-b text-sm sticky left-0 bg-background z-10">
                    {formatFeatureName(feature)}
                  </td>
                  {sortedPlans.map((plan) => (
                    <td key={plan.id} className="p-4 border-b text-center">
                      {plan.features[feature] ? (
                        <CheckCircle className="h-5 w-5 text-success mx-auto" />
                      ) : (
                        <XCircle className="h-5 w-5 text-muted-foreground mx-auto" />
                      )}
                    </td>
                  ))}
                </tr>
              ))}

              {/* Limits Section */}
              <tr className="bg-muted/50">
                <td
                  colSpan={sortedPlans.length + 1}
                  className="p-4 font-semibold text-sm sticky left-0 bg-muted/50 z-10"
                >
                  Usage Limits
                </td>
              </tr>

              {allLimits.map((limit) => (
                <tr key={limit}>
                  <td className="p-4 border-b text-sm sticky left-0 bg-background z-10">
                    {formatLimitName(limit)}
                  </td>
                  {sortedPlans.map((plan) => (
                    <td key={plan.id} className="p-4 border-b text-center">
                      {plan.limits.monthly?.[limit] === undefined ? (
                        <span className="text-muted-foreground text-sm">Not set</span>
                      ) : plan.limits.monthly[limit] === -1 ? (
                        <span className="text-success font-semibold">Unlimited</span>
                      ) : (
                        <div>
                          <div className="font-semibold">
                            {plan.limits.monthly[limit]?.toLocaleString()}
                          </div>
                          <div className="text-xs text-muted-foreground">{getLimitUnit(limit)}</div>
                        </div>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <div className="text-3xl font-bold">{plans.length}</div>
                <div className="text-sm text-muted-foreground">Total Plans</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <div className="text-3xl font-bold text-success">
                  {plans.filter((p) => p.isActive).length}
                </div>
                <div className="text-sm text-muted-foreground">Active Plans</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <div className="text-3xl font-bold text-primary">
                  {plans.filter((p) => p.isDefault).length}
                </div>
                <div className="text-sm text-muted-foreground">Default Plan</div>
              </div>
            </CardContent>
          </Card>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Helper functions
 */
function formatFeatureName(key: string): string {
  return key
    .split('.')
    .map((segment) => segment.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase()))
    .join(' / ');
}

function formatLimitName(key: string): string {
  const names: Record<string, string> = {
    'platform.users': 'Users',
    'platform.plugins': 'Plugins',
    'platform.roles': 'Roles',
    'platform.storageBytes': 'Storage',
    'platform.apiCalls': 'API Calls',
    'runlynk.calls': 'Runlynk Calls',
  };
  return names[key] || formatFeatureName(key);
}

function getLimitUnit(key: string): string {
  const units: Record<string, string> = {
    'platform.users': 'users',
    'platform.plugins': 'plugins',
    'platform.roles': 'roles',
    'platform.storageBytes': 'bytes',
    'platform.apiCalls': 'calls/month',
    'runlynk.calls': 'calls/month',
  };
  return units[key] || '';
}
