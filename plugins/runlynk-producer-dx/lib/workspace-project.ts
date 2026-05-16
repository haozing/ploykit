import { PluginError, type PluginContext, type PluginResourceScope } from '@ploykit/plugin-sdk';
import { createProject } from './core-client';

export const RUNLYNK_PROJECT_BINDING_TYPE = 'project';

export interface WorkspaceProject {
  workspaceId: string;
  projectId: string;
  scope: PluginResourceScope;
}

export async function currentWorkspaceScope(ctx: PluginContext): Promise<PluginResourceScope> {
  const workspace = await ctx.workspace.current();
  if (!workspace) {
    throw new PluginError({
      code: 'RUNLYNK_WORKSPACE_REQUIRED',
      message: 'RunLynk requires an active workspace.',
      statusCode: 400,
    });
  }
  return { type: 'workspace', id: workspace.id };
}

export async function getBoundProject(ctx: PluginContext): Promise<WorkspaceProject | null> {
  const scope = await currentWorkspaceScope(ctx);
  if (scope.type !== 'workspace') {
    return null;
  }
  const binding = await ctx.resourceBindings.get({
    scope,
    resourceType: RUNLYNK_PROJECT_BINDING_TYPE,
    status: 'active',
  });
  if (!binding) {
    return null;
  }
  return {
    workspaceId: scope.id,
    projectId: binding.resourceId,
    scope,
  };
}

export async function ensureBoundProject(ctx: PluginContext): Promise<WorkspaceProject> {
  const existing = await getBoundProject(ctx);
  if (existing) {
    return existing;
  }

  const workspace = await ctx.workspace.current();
  if (!workspace) {
    throw new PluginError({
      code: 'RUNLYNK_WORKSPACE_REQUIRED',
      message: 'RunLynk requires an active workspace.',
      statusCode: 400,
    });
  }

  const scope: PluginResourceScope = { type: 'workspace', id: workspace.id };
  const project = await createProject(
    ctx,
    {
      name: workspace.name,
      slug: workspace.slug ?? workspace.id,
      settings: {
        ploykit_workspace_id: workspace.id,
      },
    },
    scope
  );

  await ctx.resourceBindings.upsert({
    scope,
    resourceType: RUNLYNK_PROJECT_BINDING_TYPE,
    resourceId: project.id,
    displayName: project.name,
    metadata: {
      slug: project.slug,
    },
  });

  return {
    workspaceId: workspace.id,
    projectId: project.id,
    scope,
  };
}
