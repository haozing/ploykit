'use client';

import { useState, useEffect } from 'react';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { PlanWithSubscribers } from '@/hooks/use-entitlements';

/**
 * Change Plan Dialog Props
 */
interface ChangePlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userName: string;
  currentPlanId: string;
  currentPlanName: string;
  plans: PlanWithSubscribers[];
  onSuccess?: () => void;
}

/**
 * Change Plan Dialog Component
 *
 * Allows admins to change a user's subscription plan
 */
export function ChangePlanDialog({
  open,
  onOpenChange,
  userId,
  userName,
  currentPlanId,
  currentPlanName,
  plans,
  onSuccess,
}: ChangePlanDialogProps) {
  const [selectedPlanId, setSelectedPlanId] = useState(currentPlanId);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedPlanId(currentPlanId);
      setNotes('');
      setError(null);
      setSuccess(false);
    }
  }, [open, currentPlanId]);

  const selectedPlan = plans.find((p) => p.id === selectedPlanId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (selectedPlanId === currentPlanId) {
      setError('Please select a different plan');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/entitlements/${userId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          planId: selectedPlanId,
          status: 'active',
          notes: notes || `Changed from ${currentPlanName} to ${selectedPlan?.name}`,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to change plan');
      }

      setSuccess(true);

      // Close dialog after 1.5 seconds
      setTimeout(() => {
        onOpenChange(false);
        onSuccess?.();
      }, 1500);
    } catch (error) {
      console.error('Change plan error:', error);
      setError(error instanceof Error ? error.message : 'Failed to change plan');
    } finally {
      setLoading(false);
    }
  };

  const formatPrice = (plan: PlanWithSubscribers, interval: 'monthly' | 'yearly' = 'monthly') => {
    const priceNum = plan.pricing?.[interval] ?? 0;
    if (priceNum === 0) return 'Free';

    const formatted = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: plan.pricing?.currency || 'USD',
      minimumFractionDigits: 0,
    }).format(priceNum);

    return `${formatted}/${interval === 'monthly' ? 'mo' : 'yr'}`;
  };

  const getPlanDescription = (plan: PlanWithSubscribers) => {
    const langJsonb = plan.langJsonb || {};
    return (
      ((langJsonb.en as Record<string, unknown> | undefined)?.description as string | undefined) ||
      ((langJsonb.zh as Record<string, unknown> | undefined)?.description as string | undefined) ||
      ((langJsonb['zh-CN'] as Record<string, unknown> | undefined)?.description as
        | string
        | undefined) ||
      ''
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Change Subscription Plan</DialogTitle>
          <DialogDescription>
            Change the subscription plan for <strong>{userName}</strong>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Current Plan Info */}
          <div className="rounded-lg bg-muted p-4">
            <p className="text-sm text-muted-foreground">Current Plan</p>
            <p className="font-medium">{currentPlanName}</p>
          </div>

          {/* Plan Selection */}
          <div className="space-y-2">
            <Label htmlFor="plan">New Plan</Label>
            <Select value={selectedPlanId} onValueChange={setSelectedPlanId}>
              <SelectTrigger id="plan">
                <SelectValue placeholder="Select a plan" />
              </SelectTrigger>
              <SelectContent>
                {plans.map((plan) => (
                  <SelectItem key={plan.id} value={plan.id} disabled={plan.id === currentPlanId}>
                    <div className="flex items-center justify-between w-full">
                      <span>{plan.name}</span>
                      <span className="ml-4 text-muted-foreground text-sm">
                        {formatPrice(plan)}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Plan Details */}
          {selectedPlan && selectedPlan.id !== currentPlanId && (
            <div className="rounded-lg border p-4 space-y-2">
              <h4 className="font-medium">New Plan Details</h4>
              <div className="text-sm space-y-1">
                <p>
                  <span className="text-muted-foreground">Price:</span>{' '}
                  <span className="font-medium">{formatPrice(selectedPlan)}</span>
                </p>
                {getPlanDescription(selectedPlan) && (
                  <p className="text-muted-foreground">{getPlanDescription(selectedPlan)}</p>
                )}
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (Optional)</Label>
            <Textarea
              id="notes"
              placeholder="Reason for plan change..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          {/* Error Alert */}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Success Alert */}
          {success && (
            <Alert className="border-success bg-success-50 text-green-900">
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>Plan changed successfully!</AlertDescription>
            </Alert>
          )}

          {/* Footer */}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading || success}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading || success || selectedPlanId === currentPlanId}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {success ? 'Changed!' : 'Change Plan'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
