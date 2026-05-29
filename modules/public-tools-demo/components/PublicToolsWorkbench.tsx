'use client';

import { useState } from 'react';
import { delimitedToObjects, objectsToDelimited } from '../lib/csv';

type ToolMode = 'json' | 'csv' | 'text';
type Delimiter = ',' | '\t';
type SupportedLanguage = 'zh' | 'en';

interface PublicToolsCopy {
  aria: string;
  mode: string;
  jsonInput: string;
  format: string;
  minify: string;
  delimitedInput: string;
  jsonArrayInput: string;
  delimiter: string;
  comma: string;
  tab: string;
  toJson: string;
  toCsv: string;
  textInput: string;
  stats: string;
  slug: string;
  titleCase: string;
  failed: string;
}

const copyByLanguage: Record<SupportedLanguage, PublicToolsCopy> = {
  zh: {
    aria: '公开工具',
    mode: '工具模式',
    jsonInput: 'JSON 输入',
    format: '格式化',
    minify: '压缩',
    delimitedInput: '分隔符输入',
    jsonArrayInput: 'JSON 数组输入',
    delimiter: '分隔符',
    comma: '逗号',
    tab: '制表符',
    toJson: '转 JSON',
    toCsv: '转 CSV',
    textInput: '文本输入',
    stats: '统计',
    slug: 'Slug',
    titleCase: '标题格式',
    failed: '工具请求失败。',
  },
  en: {
    aria: 'Public tools',
    mode: 'Tool mode',
    jsonInput: 'JSON Input',
    format: 'Format',
    minify: 'Minify',
    delimitedInput: 'Delimited Input',
    jsonArrayInput: 'JSON Array Input',
    delimiter: 'Delimiter',
    comma: 'Comma',
    tab: 'Tab',
    toJson: 'To JSON',
    toCsv: 'To CSV',
    textInput: 'Text Input',
    stats: 'Stats',
    slug: 'Slug',
    titleCase: 'Title Case',
    failed: 'Tool request failed.',
  },
};

const solidButtonClass =
  'inline-flex min-h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:pointer-events-none disabled:opacity-50';
const ghostButtonClass =
  'inline-flex min-h-10 items-center justify-center rounded-md px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-muted disabled:pointer-events-none disabled:opacity-50';

function readCopy(language?: string): PublicToolsCopy {
  return language === 'en' ? copyByLanguage.en : copyByLanguage.zh;
}

function titleCase(source: string): string {
  return source.replace(/\S+/g, (word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1).toLowerCase()}`);
}

function slugify(source: string): string {
  return source
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function textStats(source: string) {
  const words = source.trim().length === 0 ? [] : source.trim().split(/\s+/);
  const lines = source.length === 0 ? 0 : source.split(/\r\n|\r|\n/).length;
  return {
    characters: source.length,
    words: words.length,
    lines,
  };
}

function runLocalTool(path: string, payload: Record<string, unknown>, fallbackError: string): string {
  try {
    const source = typeof payload.source === 'string' ? payload.source : '';
    if (path.endsWith('/format-json')) {
      return JSON.stringify(JSON.parse(source), null, payload.mode === 'minify' ? 0 : 2);
    }
    if (path.endsWith('/csv-to-json')) {
      return JSON.stringify(delimitedToObjects(source, payload.delimiter), null, 2);
    }
    if (path.endsWith('/json-to-csv')) {
      return objectsToDelimited(JSON.parse(source), payload.delimiter);
    }
    if (path.endsWith('/text-utils')) {
      if (payload.operation === 'slugify') {
        return slugify(source);
      }
      if (payload.operation === 'case' && payload.caseMode === 'title') {
        return titleCase(source);
      }
      return JSON.stringify(textStats(source), null, 2);
    }
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : fallbackError);
  }

  throw new Error(fallbackError);
}

export function PublicToolsWorkbench({ language }: { language?: string }) {
  const copy = readCopy(language);
  const [mode, setMode] = useState<ToolMode>('json');
  const [jsonInput, setJsonInput] = useState('{"name":"PloyKit","module":"public-tools","ready":true}');
  const [csvInput, setCsvInput] = useState('name,module,ready\nPloyKit,public-tools,true');
  const [jsonArrayInput, setJsonArrayInput] = useState(
    '[{"name":"PloyKit","module":"public-tools","ready":true}]'
  );
  const [textInput, setTextInput] = useState('PloyKit public text tools\nShip local modules faster.');
  const [delimiter, setDelimiter] = useState<Delimiter>(',');
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function runTool(path: string, payload: Record<string, unknown>) {
    setBusy(true);
    setError('');
    try {
      setOutput(runLocalTool(path, payload, copy.failed));
    } catch (toolError) {
      setOutput('');
      setError(toolError instanceof Error ? toolError.message : copy.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="tool-console" aria-label={copy.aria}>
      <div className="tool-tabs" role="tablist" aria-label={copy.mode}>
        <button
          type="button"
          className={mode === 'json' ? 'tool-tab active' : 'tool-tab'}
          onClick={() => setMode('json')}
        >
          JSON
        </button>
        <button
          type="button"
          className={mode === 'csv' ? 'tool-tab active' : 'tool-tab'}
          onClick={() => setMode('csv')}
        >
          CSV
        </button>
        <button
          type="button"
          className={mode === 'text' ? 'tool-tab active' : 'tool-tab'}
          onClick={() => setMode('text')}
        >
          Text
        </button>
      </div>

      {mode === 'json' ? (
        <div className="tool-grid">
          <label className="tool-field">
            <span>{copy.jsonInput}</span>
            <textarea value={jsonInput} onChange={(event) => setJsonInput(event.target.value)} />
          </label>
          <div className="tool-side">
            <div className="tool-actions">
              <button
                type="button"
                className={solidButtonClass}
                disabled={busy}
                onClick={() => runTool('public-tools/format-json', { source: jsonInput })}
              >
                {copy.format}
              </button>
              <button
                type="button"
                className={ghostButtonClass}
                disabled={busy}
                onClick={() =>
                  runTool('public-tools/format-json', { source: jsonInput, mode: 'minify' })
                }
              >
                {copy.minify}
              </button>
            </div>
            <pre className="tool-output">{output}</pre>
          </div>
        </div>
      ) : null}

      {mode === 'csv' ? (
        <div className="tool-grid">
          <div className="tool-field-group">
            <label className="tool-field">
              <span>{copy.delimitedInput}</span>
              <textarea value={csvInput} onChange={(event) => setCsvInput(event.target.value)} />
            </label>
            <label className="tool-field">
              <span>{copy.jsonArrayInput}</span>
              <textarea
                value={jsonArrayInput}
                onChange={(event) => setJsonArrayInput(event.target.value)}
              />
            </label>
          </div>
          <div className="tool-side">
            <div className="tool-actions">
              <select
                value={delimiter}
                onChange={(event) => setDelimiter(event.target.value === '\t' ? '\t' : ',')}
                aria-label={copy.delimiter}
              >
                <option value=",">{copy.comma}</option>
                <option value={'\t'}>{copy.tab}</option>
              </select>
              <button
                type="button"
                className={solidButtonClass}
                disabled={busy}
                onClick={() => runTool('public-tools/csv-to-json', { source: csvInput, delimiter })}
              >
                {copy.toJson}
              </button>
              <button
                type="button"
                className={ghostButtonClass}
                disabled={busy}
                onClick={() =>
                  runTool('public-tools/json-to-csv', { source: jsonArrayInput, delimiter })
                }
              >
                {copy.toCsv}
              </button>
            </div>
            <pre className="tool-output">{output}</pre>
          </div>
        </div>
      ) : null}

      {mode === 'text' ? (
        <div className="tool-grid">
          <label className="tool-field">
            <span>{copy.textInput}</span>
            <textarea value={textInput} onChange={(event) => setTextInput(event.target.value)} />
          </label>
          <div className="tool-side">
            <div className="tool-actions">
              <button
                type="button"
                className={solidButtonClass}
                disabled={busy}
                onClick={() => runTool('public-tools/text-utils', { source: textInput })}
              >
                {copy.stats}
              </button>
              <button
                type="button"
                className={ghostButtonClass}
                disabled={busy}
                onClick={() =>
                  runTool('public-tools/text-utils', {
                    source: textInput,
                    operation: 'slugify',
                  })
                }
              >
                {copy.slug}
              </button>
              <button
                type="button"
                className={ghostButtonClass}
                disabled={busy}
                onClick={() =>
                  runTool('public-tools/text-utils', {
                    source: textInput,
                    operation: 'case',
                    caseMode: 'title',
                  })
                }
              >
                {copy.titleCase}
              </button>
            </div>
            <pre className="tool-output">{output}</pre>
          </div>
        </div>
      ) : null}

      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}
