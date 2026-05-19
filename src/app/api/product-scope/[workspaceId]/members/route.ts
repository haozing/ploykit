import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db/client.server';
import { workspaceMembers } from '@/lib/db/schema/plugin-platform';
import { productScopeMembersDisabled, productScopeService } from '@/lib/product-scope';
import { getRuntimeProductId } from '@/lib/plugin-runtime/product-id';
import { withAuth, withErrorHandling, type AuthContext, type RouteContext } from '@/lib/middleware';

const querySchema = z.object({
  productId: z.string().optional(),
});

export const GET = withErrorHandling(
  withAuth(
    async (
      request: NextRequest,
      context: RouteContext<{ workspaceId: string }> & { auth: AuthContext }
    ) => {
      const { workspaceId } = await context.params;
      const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
      const productId = getRuntimeProductId({ productId: query.productId });
      const product = await productScopeService.describe({ productId });
      if (!product.profile.allowMembers) {
        throw productScopeMembersDisabled({ productId, mode: product.profile.mode });
      }

      await productScopeService.requireRole({
        productId,
        userId: context.auth.userId,
        userEmail: context.auth.userEmail,
        requestedWorkspaceId: workspaceId,
        roles: ['owner', 'admin', 'editor', 'viewer'],
      });

      const members = await db
        .select()
        .from(workspaceMembers)
        .where(
          and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.status, 'active'))
        );

      return NextResponse.json({ success: true, data: members });
    }
  )
);
