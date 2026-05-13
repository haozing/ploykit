/**
 * ════════════════════════════════════════════════════════════
 * Debug API: 插槽SystemStatusQuery
 * ════════════════════════════════════════════════════════════
 *
 * GET /api/debug/slots
 *
 * 用atDebug插槽System，查看current内存inof插槽RegisterStatus
 *
 * 🧪 临whenFeature：ifChecktoStatuslose，自动fromDatabase恢复
 */

/* eslint-disable no-console */
import { NextResponse } from 'next/server';
import { slotManager } from '@/lib/ui/slots/slot-manager';
import { env } from '@/lib/_core/env';

export async function GET() {
  // 🔒 Disable debug endpoints in production
  if (env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'Debug endpoints are disabled in production' },
      { status: 404 }
    );
  }

  console.log('[DEBUG] /api/debug/slots called');

  // Get插槽Status
  const stats = slotManager.getStats();
  const details = slotManager.getDetailedState();

  return NextResponse.json({
    stats,
    details,
    timestamp: new Date().toISOString(),
    message:
      stats.totalSlots > 0
        ? `找to ${stats.totalSlots} 插槽，共 ${stats.totalRegistrations} Register`
        : '没有找to任何插槽Register！Pluginmay未EnableorRegisterFailed。',
  });
}
