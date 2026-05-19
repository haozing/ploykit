import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/client.server';
import { workspaceInvitations, type NewWorkspaceInvitation } from '@/lib/db/schema/plugin-platform';
import { productScopeMembersDisabled, productScopeService } from '@/lib/product-scope';
import { getRuntimeProductId } from '@/lib/plugin-runtime/product-id';
import { withAuth, withErrorHandling, type AuthContext, type RouteContext } from '@/lib/middleware';

const querySchema = z.object({
  productId: z.string().optional(),
});

const inviteBodySchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'editor', 'viewer']),
});

export const POST = withErrorHandling(
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
        roles: ['owner', 'admin'],
      });

      const body = inviteBodySchema.parse(await request.json());
      const [invitation] = await db
        .insert(workspaceInvitations)
        .values({
          id: randomUUID(),
          workspaceId,
          email: body.email.toLowerCase(),
          role: body.role,
          status: 'pending',
          invitedByUserId: context.auth.userId,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        } satisfies NewWorkspaceInvitation)
        .returning();

      return NextResponse.json({ success: true, data: invitation }, { status: 201 });
    }
  )
);
