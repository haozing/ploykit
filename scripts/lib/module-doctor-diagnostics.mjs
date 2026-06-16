export function locateInSource(source, needle) {
  if (!needle) {
    return {};
  }
  const index = source.indexOf(needle);
  if (index < 0) {
    return {};
  }
  const before = source.slice(0, index);
  const lines = before.split(/\r?\n/);
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

export function classifyDiagnostic(code) {
  if (code.includes('MAP')) {
    return { category: 'map', subsystem: 'module-map' };
  }
  if (code.includes('PERMISSION') || code.includes('EGRESS') || code.includes('AUTH')) {
    return { category: 'security', subsystem: 'permissions' };
  }
  if (code.includes('DATA')) {
    return { category: 'data', subsystem: 'data' };
  }
  if (
    code.includes('PRESENTATION') ||
    code.includes('SURFACE') ||
    code.includes('THEME') ||
    code.includes('I18N') ||
    code.includes('NAVIGATION')
  ) {
    return { category: 'presentation', subsystem: code.includes('SURFACE') ? 'surfaces' : 'i18n' };
  }
  if (code.includes('ROUTE') || code.includes('API') || code.includes('WEBHOOK')) {
    return { category: 'contract', subsystem: 'routes' };
  }
  if (code.includes('ACTION')) {
    return { category: 'contract', subsystem: 'actions' };
  }
  if (
    code.includes('HOST_INTERNAL') ||
    code.includes('RAW_FETCH') ||
    code.includes('PROCESS_ENV') ||
    code.includes('NODE_BUILTIN') ||
    code.includes('DYNAMIC_CTX') ||
    code.includes('DYNAMIC_CODE') ||
    code.includes('DYNAMIC_IMPORT') ||
    code.includes('DYNAMIC_REQUIRE') ||
    code.includes('SOURCE_IMPORT')
  ) {
    return { category: 'source', subsystem: 'doctor' };
  }
  return { category: 'contract', subsystem: 'module' };
}

export function diagnostic(severity, code, message, pathValue, fix, details, location = {}) {
  const classified = classifyDiagnostic(code);
  return {
    severity,
    code,
    message,
    ...(pathValue ? { path: pathValue } : {}),
    ...(fix ? { fix } : {}),
    ...classified,
    ...(location.line ? { line: location.line } : {}),
    ...(location.column ? { column: location.column } : {}),
    ...(details ? { details } : {}),
  };
}

export function normalizeDiagnostic(item) {
  return diagnostic(
    item.severity ?? 'error',
    item.code ?? 'MODULE_DIAGNOSTIC_UNKNOWN',
    item.message ?? 'Module diagnostic failed.',
    item.path,
    item.fix,
    item.details,
    { line: item.line, column: item.column }
  );
}

export function dedupeDiagnostics(diagnostics) {
  const seen = new Set();
  const result = [];
  for (const item of diagnostics) {
    const key = `${item.severity}:${item.code}:${item.path ?? ''}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}
