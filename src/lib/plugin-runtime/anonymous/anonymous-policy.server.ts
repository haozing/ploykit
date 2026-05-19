import 'server-only';

import { PluginError, type PluginAnonymousPolicy, type PluginRouteAuth } from '@ploykit/plugin-sdk';
import { env } from '@/lib/_core/env';

export type AnonymousHighCostAction = 'ai' | 'connector' | 'files.upload' | 'runs.create';

export interface AnonymousRuntimeRoute {
  path: string;
  auth: PluginRouteAuth;
}

export interface AnonymousRuntimePolicyState {
  route: AnonymousRuntimeRoute;
  policy?: PluginAnonymousPolicy;
  anonymous: boolean;
}

export function createAnonymousPolicyError(input: {
  action: AnonymousHighCostAction;
  pluginId: string;
  routePath?: string;
}): PluginError {
  return new PluginError({
    code: 'PLUGIN_ANONYMOUS_HIGH_COST_FORBIDDEN',
    message: `Anonymous public route cannot perform high-cost action "${input.action}".`,
    statusCode: 403,
    fix: 'Declare anonymousPolicy.allowHighCostActions: true for this public route, or require auth.',
    details: {
      pluginId: input.pluginId,
      routePath: input.routePath,
      action: input.action,
    },
  });
}

export function assertAnonymousHighCostAllowed(
  state: AnonymousRuntimePolicyState | undefined,
  input: {
    action: AnonymousHighCostAction;
    pluginId: string;
  }
): void {
  if (!state?.anonymous || state.route.auth !== 'public') {
    return;
  }

  if (state.policy?.allowHighCostActions === true) {
    return;
  }

  throw createAnonymousPolicyError({
    action: input.action,
    pluginId: input.pluginId,
    routePath: state.route.path,
  });
}

function captchaError(input: {
  code: string;
  message: string;
  pluginId: string;
  routePath: string;
}): PluginError {
  return new PluginError({
    code: input.code,
    message: input.message,
    statusCode: 403,
    fix: 'Provide a valid captcha token in the x-plugin-captcha-token header or require authentication.',
    details: {
      pluginId: input.pluginId,
      routePath: input.routePath,
    },
  });
}

async function verifyTurnstileToken(token: string, request: Request): Promise<boolean> {
  const secret = env.PLUGIN_TURNSTILE_SECRET_KEY ?? env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
  if (!secret) {
    return (
      token === 'test-captcha-token' ||
      (Boolean(env.PLUGIN_ANONYMOUS_CAPTCHA_BYPASS_TOKEN) &&
        token === env.PLUGIN_ANONYMOUS_CAPTCHA_BYPASS_TOKEN)
    );
  }

  const formData = new FormData();
  formData.set('secret', secret);
  formData.set('response', token);
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (ip) {
    formData.set('remoteip', ip);
  }

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData,
    });
    const data = (await response.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

export async function verifyAnonymousCaptcha(input: {
  request: Request;
  pluginId: string;
  route: AnonymousRuntimeRoute;
  policy?: PluginAnonymousPolicy;
}): Promise<void> {
  if (input.policy?.captcha !== 'always') {
    return;
  }

  const token = input.request.headers.get('x-plugin-captcha-token')?.trim();
  if (!token) {
    throw captchaError({
      code: 'PLUGIN_ANONYMOUS_CAPTCHA_REQUIRED',
      message: 'Anonymous public route requires captcha verification.',
      pluginId: input.pluginId,
      routePath: input.route.path,
    });
  }

  const valid = await verifyTurnstileToken(token, input.request);
  if (!valid) {
    throw captchaError({
      code: 'PLUGIN_ANONYMOUS_CAPTCHA_INVALID',
      message: 'Anonymous captcha verification failed.',
      pluginId: input.pluginId,
      routePath: input.route.path,
    });
  }
}
