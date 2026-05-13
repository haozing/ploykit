/**
 * ════════════════════════════════════════════════════════════
 * Debug API: Test插槽渲染
 * ════════════════════════════════════════════════════════════
 *
 * GET /api/debug/render-slot?slot=header:extra
 *
 * 用atTest特定插槽of渲染过程，查看Whether能SuccessLoadingComponent
 */

/* eslint-disable no-console */
import { NextResponse } from 'next/server';
import { slotManager } from '@/lib/ui/slots/slot-manager';
import type { SlotName } from '@/lib/ui/slots/types';
import { env } from '@/lib/_core/env';

export async function GET(request: Request) {
  // 🔒 Disable debug endpoints in production
  if (env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'Debug endpoints are disabled in production' },
      { status: 404 }
    );
  }

  const { searchParams } = new URL(request.url);
  const slotName = (searchParams.get('slot') as SlotName) || 'header:extra';

  try {
    console.log(`[DEBUG] Attempting to render slot: ${slotName}`);

    const components = await slotManager.renderSlot(slotName, 'append');

    return NextResponse.json({
      success: true,
      slotName,
      componentCount: components.length,
      components: components.map((c, i) => ({
        index: i,
        type: typeof c,
        isNull: c === null,
        hasProps: c && typeof c === 'object' && 'props' in c,
      })),
      message:
        components.length > 0
          ? `Success渲染 ${components.length} Component`
          : '没有Componentbe渲染。mayYes：1) 插槽未Register 2) ComponentLoadingFailed',
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        slotName,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        errorType: error instanceof Error ? error.constructor.name : typeof error,
      },
      { status: 500 }
    );
  }
}
