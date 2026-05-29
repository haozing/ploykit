import React, { isValidElement, type ReactNode } from 'react';
import type { SupportedLanguage } from '@host/lib/i18n';
import { translateHostMessage } from '@host/lib/host-i18n';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

interface StructuredModulePage {
  view: string;
  title: string;
  primarySurface: string;
  userQuestion: string;
  quickSignals: string[];
  primaryActions: string[];
  recoveryActions: string[];
  states: {
    loading?: string;
    empty?: string;
    partialFailure?: string;
    coreError?: string;
  };
  evidence: string[];
  sections: {
    id: string;
    title: string;
    data: string[];
  }[];
  loaderData?: unknown;
  language?: string;
}

const secretKeyPattern =
  /(^|[-_.\s])(?:admin[_-]?token|api[_-]?key|bearer[_-]?token|callback[_-]?secret|client[_-]?secret|decryption[_-]?key|hmac[_-]?secret|password|private[_-]?key|producer[_-]?key|secret|signing[_-]?secret|token|webhook[_-]?secret|worker[_-]?token|zero[_-]?knowledge[_-]?key)$/i;

const secretTextPatterns = [
  /\brlwk_[A-Za-z0-9._-]+/g,
  /\brlpk_[A-Za-z0-9._-]+/g,
  /\bwhsec_[A-Za-z0-9._-]+/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
];

function redactModuleText(value: string): string {
  return secretTextPatterns.reduce(
    (current, pattern) => current.replace(pattern, '[redacted-secret]'),
    value
  );
}

function redactModuleValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactModuleText(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactModuleValue);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        secretKeyPattern.test(key) ? '[redacted-secret]' : redactModuleValue(item),
      ])
    );
  }
  return value;
}

function isStructuredModulePage(value: unknown): value is StructuredModulePage {
  if (!isRecord(value) || !isRecord(value.states)) {
    return false;
  }
  return (
    typeof value.view === 'string' &&
    typeof value.title === 'string' &&
    typeof value.primarySurface === 'string' &&
    typeof value.userQuestion === 'string' &&
    isStringArray(value.quickSignals) &&
    isStringArray(value.primaryActions) &&
    isStringArray(value.recoveryActions) &&
    isStringArray(value.evidence) &&
    Array.isArray(value.sections)
  );
}

function humanizeKey(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\bapi\b/gi, 'API')
    .replace(/\bdx\b/gi, 'DX')
    .replace(/\bid\b/gi, 'ID')
    .replace(/\bok\b/gi, 'OK')
    .replace(/^./, (letter) => letter.toUpperCase());
}

function toCamel(value: string): string {
  return value.replace(/[_-]([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function readLoaderRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function readLoaderValue(loaderData: unknown, key: string): unknown {
  const record = readLoaderRecord(loaderData);
  if (!record) {
    return undefined;
  }
  if (key in record) {
    return record[key];
  }
  const camel = toCamel(key);
  return camel in record ? record[camel] : undefined;
}

function compactValue(value: unknown): string {
  if (value === undefined) {
    return 'Not reported';
  }
  if (value === null || value === '') {
    return 'None';
  }
  if (typeof value === 'boolean') {
    return value ? 'Ready' : 'Missing';
  }
  if (typeof value === 'number' || typeof value === 'string') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `${value.length} ${value.length === 1 ? 'item' : 'items'}`;
  }
  if (isRecord(value)) {
    return `${Object.keys(value).length} fields`;
  }
  return String(value);
}

function modulePageLanguage(page: StructuredModulePage): SupportedLanguage {
  return page.language === 'zh' ? 'zh' : 'en';
}

const MODULE_VALUE_TEXT_KEYS: Record<string, string> = {
  'Setup required': 'moduleValue.setupRequired',
  'Needs attention': 'moduleValue.needsAttention',
  Ready: 'moduleValue.ready',
  'Quick signals': 'moduleValue.quickSignals',
  'Primary actions': 'moduleValue.primaryActions',
  'Recovery actions': 'moduleValue.recoveryActions',
  'Operator workflow': 'moduleValue.operatorWorkflow',
  Decision: 'moduleValue.decision',
  'Next actions': 'moduleValue.nextActions',
  'Recovery path': 'moduleValue.recoveryPath',
  'Release evidence': 'moduleValue.releaseEvidence',
  'Operational facts': 'moduleValue.operationalFacts',
  Evidence: 'moduleValue.evidence',
  'Not reported': 'moduleValue.notReported',
  None: 'moduleValue.none',
  Missing: 'moduleValue.missing',
};

function moduleValueText(language: SupportedLanguage, source: string): string {
  const key = MODULE_VALUE_TEXT_KEYS[source];
  return key ? translateHostMessage(language, key, { fallback: source }) : source;
}

function StructuredModulePageValue({ page }: { page: StructuredModulePage }) {
  const loader = readLoaderRecord(page.loaderData);
  const setupRequired = loader?.setupRequired === true;
  const ok = loader?.ok;
  const language = modulePageLanguage(page);
  const workflowRows = [
    [moduleValueText(language, 'Decision'), page.userQuestion],
    [
      moduleValueText(language, 'Next actions'),
      page.primaryActions.slice(0, 3).map(humanizeKey).join(' -> '),
    ],
    [
      moduleValueText(language, 'Recovery path'),
      page.recoveryActions.slice(0, 3).map(humanizeKey).join(' -> '),
    ],
    [moduleValueText(language, 'Release evidence'), page.evidence.slice(0, 4).join(', ')],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-border pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
            <span>{humanizeKey(page.primarySurface)}</span>
            <span aria-hidden>/</span>
            <span>{page.view}</span>
          </div>
          <h2 className="mt-2 text-2xl font-semibold text-foreground">{page.title}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            {page.userQuestion}
          </p>
        </div>
        <div className="flex min-h-10 shrink-0 items-center rounded-md border border-border px-3 text-sm font-semibold text-foreground">
          {moduleValueText(
            language,
            setupRequired ? 'Setup required' : ok === false ? 'Needs attention' : 'Ready'
          )}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-foreground">
          {moduleValueText(language, 'Quick signals')}
        </h3>
        <dl className="mt-3 grid grid-cols-1 border-y border-border sm:grid-cols-2 lg:grid-cols-3">
          {page.quickSignals.map((signal) => (
            <div key={signal} className="min-h-20 border-b border-border py-3 sm:px-3">
              <dt className="text-xs font-medium text-muted-foreground">{humanizeKey(signal)}</dt>
              <dd className="mt-1 break-words text-sm font-semibold text-foreground">
                {moduleValueText(language, compactValue(readLoaderValue(page.loaderData, signal)))}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {[
          [moduleValueText(language, 'Primary actions'), page.primaryActions],
          [moduleValueText(language, 'Recovery actions'), page.recoveryActions],
        ].map(([title, actions]) => (
          <div key={title as string}>
            <h3 className="text-sm font-semibold text-foreground">{title as string}</h3>
            <ul className="mt-3 divide-y divide-border border-y border-border">
              {(actions as string[]).map((action) => (
                <li key={action} className="flex min-h-11 items-center py-2 text-sm">
                  <span className="text-foreground">{humanizeKey(action)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-foreground">
          {moduleValueText(language, 'Operator workflow')}
        </h3>
        <dl className="mt-3 divide-y divide-border border-y border-border">
          {workflowRows.map(([label, value]) => (
            <div key={label} className="grid gap-1 py-3 text-sm sm:grid-cols-[180px_minmax(0,1fr)]">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-words font-medium text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {moduleValueText(language, 'Operational facts')}
          </h3>
          <div className="mt-3 divide-y divide-border border-y border-border">
            {page.sections.map((section) => (
              <section key={section.id} className="py-4">
                <h4 className="text-sm font-semibold text-foreground">{section.title}</h4>
                <dl className="mt-2 grid gap-2">
                  {section.data.map((key) => (
                    <div key={key} className="grid gap-1 text-sm sm:grid-cols-[180px_minmax(0,1fr)]">
                      <dt className="text-muted-foreground">{humanizeKey(key)}</dt>
                      <dd className="min-w-0 break-words font-medium text-foreground">
                        {moduleValueText(
                          language,
                          compactValue(readLoaderValue(page.loaderData, key))
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {moduleValueText(language, 'Evidence')}
            </h3>
            <ul className="mt-3 divide-y divide-border border-y border-border">
              {page.evidence.map((item) => (
                <li key={item} className="min-h-10 py-2 text-sm text-foreground">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function renderScalar(value: string | number | boolean): ReactNode {
  return <span>{String(value)}</span>;
}

export function ModuleValue({ value }: { value: unknown }) {
  if (isValidElement(value)) {
    return value;
  }

  if (isStructuredModulePage(value)) {
    return <StructuredModulePageValue page={value} />;
  }

  if (value === null || value === undefined) {
    return <span className="muted">No module output.</span>;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return <p className="module-output-text">{renderScalar(value)}</p>;
  }

  if (Array.isArray(value)) {
    return (
      <ul className="module-list">
        {value.map((item, index) => (
          <li key={index}>
            <ModuleValue value={item} />
          </li>
        ))}
      </ul>
    );
  }

  if (isRecord(value) && ('title' in value || 'message' in value)) {
    return (
      <div className="module-object">
        {typeof value.title === 'string' ? <h2>{value.title}</h2> : null}
        {typeof value.message === 'string' ? <p>{value.message}</p> : null}
        <pre>{JSON.stringify(redactModuleValue(value), null, 2)}</pre>
      </div>
    );
  }

  return <pre className="module-json">{JSON.stringify(redactModuleValue(value), null, 2)}</pre>;
}
