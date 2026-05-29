import { apiOk, readJsonObject, requireApiSession } from '@host/lib/api';
import {
  getHostBillingTaxProfile,
  updateHostBillingTaxProfile,
} from '@host/lib/billing-api';
import { languageFromRequest, localizedPath } from '@host/lib/i18n';
import { NextResponse } from 'next/server';

function formString(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim().slice(0, 160) : '';
}

export async function GET(request: Request) {
  const resolved = await requireApiSession(request, 'billing.taxProfile');
  if (resolved instanceof Response) {
    return resolved;
  }
  return apiOk({ taxProfile: await getHostBillingTaxProfile(resolved.session) });
}

export async function PATCH(request: Request) {
  const resolved = await requireApiSession(request, 'billing.taxProfile');
  if (resolved instanceof Response) {
    return resolved;
  }
  const taxProfile = await updateHostBillingTaxProfile(
    resolved.session,
    await readJsonObject(request)
  );
  return apiOk({ taxProfile });
}

export async function POST(request: Request) {
  const resolved = await requireApiSession(request, 'billing.taxProfile');
  if (resolved instanceof Response) {
    return resolved;
  }
  const form = await request.formData();
  await updateHostBillingTaxProfile(resolved.session, {
    company: formString(form, 'company'),
    taxId: formString(form, 'taxId'),
    country: formString(form, 'country'),
  });
  return NextResponse.redirect(
    new URL(localizedPath(languageFromRequest(request), '/dashboard/billing'), request.url),
    303
  );
}
