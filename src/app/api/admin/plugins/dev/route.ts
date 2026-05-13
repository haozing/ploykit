import { NextResponse } from 'next/server';
import { withAdminGuard, withErrorHandling } from '@/lib/middleware';
import { buildPluginDevConsoleReport } from '@/lib/plugin-runtime/dev-console';

export const GET = withAdminGuard(
  withErrorHandling(async () => {
    const report = await buildPluginDevConsoleReport();

    return NextResponse.json(
      {
        success: true,
        data: report,
      },
      { status: 200 }
    );
  })
);
