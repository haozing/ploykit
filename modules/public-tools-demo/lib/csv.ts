type CsvRecord = Record<string, string>;

function normalizeDelimiter(value: unknown): ',' | '\t' {
  return value === '\t' || value === 'tab' ? '\t' : ',';
}

function escapeCsvCell(value: unknown, delimiter: ',' | '\t'): string {
  const cell = value === null || value === undefined ? '' : String(value);
  return cell.includes('"') || cell.includes('\n') || cell.includes('\r') || cell.includes(delimiter)
    ? `"${cell.replace(/"/g, '""')}"`
    : cell;
}

export function parseDelimitedRows(source: string, delimiterInput?: unknown): string[][] {
  const delimiter = normalizeDelimiter(delimiterInput);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
        continue;
      }
      if (char === '"') {
        quoted = false;
        continue;
      }
      cell += char;
      continue;
    }

    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      row.push(cell);
      cell = '';
      continue;
    }
    if (char === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += char;
  }

  row.push(cell.replace(/\r$/, ''));
  rows.push(row);

  return rows.filter((candidate) => candidate.some((value) => value.trim().length > 0));
}

export function delimitedToObjects(source: string, delimiterInput?: unknown): CsvRecord[] {
  const [headerRow, ...bodyRows] = parseDelimitedRows(source, delimiterInput);
  if (!headerRow || headerRow.length === 0) {
    return [];
  }

  const headers = headerRow.map((header, index) => header.trim() || `column_${index + 1}`);
  return bodyRows.map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']))
  );
}

export function objectsToDelimited(source: unknown, delimiterInput?: unknown): string {
  const delimiter = normalizeDelimiter(delimiterInput);
  if (!Array.isArray(source)) {
    throw new Error('JSON_ARRAY_REQUIRED');
  }

  const records = source.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item && typeof item === 'object' && !Array.isArray(item))
  );
  const headers = Array.from(new Set(records.flatMap((record) => Object.keys(record))));
  const lines = [
    headers.map((header) => escapeCsvCell(header, delimiter)).join(delimiter),
    ...records.map((record) =>
      headers.map((header) => escapeCsvCell(record[header], delimiter)).join(delimiter)
    ),
  ];

  return lines.join('\n');
}
