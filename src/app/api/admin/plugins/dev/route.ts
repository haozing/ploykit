import { NextResponse } from 'next/server';
import { withAdminGuard, withErrorHandling } from '@/lib/middleware';
import { buildPluginDevConsoleReport } from '@/lib/plugin-runtime/dev-console';

export const GET = withAdminGuard(
  withErrorHandling(async (request) => {
    const includeRuntime = ['1', 'true'].includes(
      new URL(request.url).searchParams.get('includeRuntime') ?? ''
    );
    const report = await buildPluginDevConsoleReport({ includeRuntime });

    return NextResponse.json(
      {
        success: true,
        data: report,
      },
      { status: 200 }
    );
  })
);
