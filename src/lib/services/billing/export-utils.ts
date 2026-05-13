export function toCsvValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  const text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);

  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((row) => row.map(toCsvValue).join(',')).join('\n');
}

export function buildExportWatermark(input: {
  actorId: string;
  actorEmail?: string;
  resource: string;
  exportedAt?: Date;
}): string {
  const exportedAt = input.exportedAt ?? new Date();
  const actor = input.actorEmail ? `${input.actorEmail} (${input.actorId})` : input.actorId;
  return `Exported ${input.resource} for ${actor} at ${exportedAt.toISOString()}`;
}

export function toWatermarkedCsv(watermark: string, rows: unknown[][]): string {
  return `# ${watermark}\n${toCsv(rows)}`;
}
