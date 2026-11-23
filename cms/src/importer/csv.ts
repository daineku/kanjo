/**
 * A small RFC 4180 CSV reader and writer. No dependency.
 *
 * Handles what real supplier exports contain: a UTF-8 byte-order mark, CRLF or
 * LF line endings, quoted fields, doubled quotes inside quoted fields, and
 * line breaks inside quoted fields. It does not guess delimiters: the import
 * template is comma-separated, and a file that is not is reported as such
 * rather than half-parsed.
 */

export class CsvError extends Error {}

export function parseCsvRows(input: string): string[][] {
  return parseCsvLines(input).map((entry) => entry.cells);
}

/**
 * Rows with the 1-based physical line each one STARTS on — what a spreadsheet
 * shows as the row number — so an issue reported on "row 14" is on line 14
 * even when the file has blank lines or line breaks inside quoted fields.
 */
export function parseCsvLines(input: string): { line: number; cells: string[] }[] {
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows: { line: number; cells: string[] }[] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldWasQuoted = false;
  let line = 1;
  let rowStart = 1;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = '';
    fieldWasQuoted = false;
  };
  const endRow = () => {
    endField();
    // Skip lines that are entirely empty (a trailing newline, a blank spacer).
    if (!(row.length === 1 && row[0] === '')) rows.push({ line: rowStart, cells: row });
    row = [];
  };

  while (i < text.length) {
    const char = text[i] as string;

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      if (char === '\n') line += 1;
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      if (field.length > 0 || fieldWasQuoted) {
        throw new CsvError(`Unexpected quote on line ${line}: quotes inside a field must be doubled and the field quoted`);
      }
      inQuotes = true;
      fieldWasQuoted = true;
      i += 1;
      continue;
    }
    if (char === ',') {
      endField();
      i += 1;
      continue;
    }
    if (char === '\r' || char === '\n') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      endRow();
      line += 1;
      rowStart = line;
      i += 1;
      continue;
    }
    if (fieldWasQuoted) {
      throw new CsvError(`Unexpected text after a closing quote on line ${line}`);
    }
    field += char;
    i += 1;
  }

  if (inQuotes) throw new CsvError('The file ends inside a quoted field');
  if (field.length > 0 || fieldWasQuoted || row.length > 0) endRow();

  return rows;
}

export type CsvRecord = { rowNumber: number; values: Record<string, string> };

/** Normalises a header cell: "Source Price (THB)" → "source_price_thb". */
export function headerKey(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function parseCsv(input: string): { headers: string[]; records: CsvRecord[] } {
  const lines = parseCsvLines(input);
  const headerRow = lines[0]?.cells;
  if (!headerRow) throw new CsvError('The file is empty');

  const headers = headerRow.map(headerKey);
  if (headers.every((header) => header === '')) throw new CsvError('The first row must be the column headers');
  if (headers.length === 1 && /[;\t]/.test(headerRow[0] ?? '')) {
    throw new CsvError('The file does not look comma-separated. Export it as CSV (comma delimited, UTF-8).');
  }
  const duplicates = headers.filter((header, index) => header && headers.indexOf(header) !== index);
  if (duplicates.length > 0) throw new CsvError(`Duplicate column: ${[...new Set(duplicates)].join(', ')}`);

  const records: CsvRecord[] = [];
  lines.slice(1).forEach(({ line, cells: row }) => {
    if (row.every((cell) => cell.trim() === '')) return;
    const values: Record<string, string> = {};
    headers.forEach((header, column) => {
      if (header) values[header] = (row[column] ?? '').trim();
    });
    // The physical line the record starts on: the spreadsheet row number.
    records.push({ rowNumber: line, values });
  });
  return { headers, records };
}

/**
 * Serialise rows to CSV.
 *
 * A cell that begins with =, +, - or @ is prefixed with an apostrophe: opened
 * in a spreadsheet such a cell is a FORMULA, and supplier-supplied text is not
 * something to hand a spreadsheet as code.
 */
export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const cell = (value: unknown): string => {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [columns.map(cell).join(',')];
  for (const row of rows) lines.push(columns.map((column) => cell(row[column])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}
