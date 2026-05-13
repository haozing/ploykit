import { NextRequest, NextResponse } from 'next/server';
import { getUsagePatterns } from '@/lib/services/audit/analytics-service';
import { withAdminGuard, withErrorHandling } from '@/lib/middleware';
import { ValidationError } from '@/lib/_core/errors';

/**
 * GET /api/admin/analytics/usage-patterns
 *
 * Get usage pattern analysis for a metric
 *
 * ACCESS CONTROL:
 * - Requires admin role
 */
export const GET = withAdminGuard(
  withErrorHandling(async (request: NextRequest) => {
    const { searchParams } = new URL(request.url);
    const metricParam = searchParams.get('metric');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    if (!metricParam || !startDate || !endDate) {
      throw new ValidationError('metric, startDate and endDate are required', {
        fields: ['metric', 'startDate', 'endDate'],
      });
    }

    // Map API metric names to function metric names
    const metricMap: Record<
      string,
      | 'platform.hooksCreated'
      | 'platform.pluginsInstalled'
      | 'platform.storageBytes'
      | 'platform.apiCalls'
    > = {
      'platform.apiCalls': 'platform.apiCalls',
      'platform.pluginsInstalled': 'platform.pluginsInstalled',
      'platform.storageBytes': 'platform.storageBytes',
      'platform.hooksCreated': 'platform.hooksCreated',
    };

    const metric = metricMap[metricParam];

    if (!metric) {
      throw new ValidationError('Invalid metric. Must be one of the scoped platform metric keys.', {
        field: 'metric',
        allowedMetrics: Object.keys(metricMap),
      });
    }

    const patterns = await getUsagePatterns(metric, {
      startDate: new Date(startDate),
      endDate: new Date(endDate),
    });

    return NextResponse.json({
      success: true,
      patterns,
    });
  })
);
