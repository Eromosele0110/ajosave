/**
 * Secure streaming exports (#39).
 * Streams CSV row-by-row from an async source so large exports never buffer in memory,
 * neutralises spreadsheet formula injection, and caps rows to bound resource use.
 */
export const MAX_EXPORT_ROWS = 50_000;

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** Escape a value for CSV, guarding against CSV/formula injection (OWASP). */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (typeof value === "string" && FORMULA_PREFIX.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Restrict download filenames to a safe charset to prevent header injection / path tricks. */
export function safeExportFilename(name: string, ext = "csv"): string {
  const base = name.replace(/\.[a-z0-9]+$/i, "").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64);
  return `${base || "export"}.${ext}`;
}

export interface CsvStreamOptions<T> {
  columns: { key: keyof T & string; header: string }[];
  maxRows?: number;
  signal?: AbortSignal;
  onComplete?: (info: { rows: number; truncated: boolean }) => void;
}

export function createCsvStream<T extends Record<string, unknown>>(
  rows: AsyncIterable<T> | Iterable<T>,
  { columns, maxRows = MAX_EXPORT_ROWS, signal, onComplete }: CsvStreamOptions<T>
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator =
    Symbol.asyncIterator in (rows as object)
      ? (rows as AsyncIterable<T>)[Symbol.asyncIterator]()
      : (async function* () { yield* rows as Iterable<T>; })();
  let count = 0;
  let headerSent = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!headerSent) {
          headerSent = true;
          controller.enqueue(encoder.encode(columns.map((c) => escapeCsvCell(c.header)).join(",") + "\r\n"));
          return;
        }
        if (signal?.aborted) throw new Error("Export aborted");
        if (count >= maxRows) {
          await iterator.return?.();
          onComplete?.({ rows: count, truncated: true });
          controller.close();
          return;
        }
        const next = await iterator.next();
        if (next.done) {
          onComplete?.({ rows: count, truncated: false });
          controller.close();
          return;
        }
        count++;
        controller.enqueue(encoder.encode(columns.map((c) => escapeCsvCell(next.value[c.key])).join(",") + "\r\n"));
      } catch (err) {
        await iterator.return?.();
        controller.error(err);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

/** Headers for an export download: no caching, no sniffing, attachment with a sanitised name. */
export function exportResponseHeaders(filename: string): Record<string, string> {
  return {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${safeExportFilename(filename)}"`,
    "Cache-Control": "no-store, private",
    "X-Content-Type-Options": "nosniff",
  };
}
