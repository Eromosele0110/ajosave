/**
 * @jest-environment node
 */
import { escapeCsvCell, safeExportFilename, createCsvStream, exportResponseHeaders } from "../streaming-export";

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    out += decoder.decode(value);
  }
}

describe("escapeCsvCell", () => {
  it("neutralises formula injection", () => {
    expect(escapeCsvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(escapeCsvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });
  it("keeps negative numbers intact", () => {
    expect(escapeCsvCell(-5)).toBe("-5");
  });
  it("quotes commas, quotes and newlines", () => {
    expect(escapeCsvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
  });
  it("handles null and dates", () => {
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("safeExportFilename", () => {
  it("strips unsafe characters", () => {
    expect(safeExportFilename('../../etc/"passwd\r\n')).toBe("etc_passwd.csv");
    expect(safeExportFilename("")).toBe("export.csv");
  });
});

describe("createCsvStream", () => {
  const columns = [{ key: "id" as const, header: "ID" }, { key: "amount" as const, header: "Amount" }];

  it("streams header and rows", async () => {
    const onComplete = jest.fn();
    const out = await readAll(createCsvStream([{ id: "1", amount: 10 }], { columns, onComplete }));
    expect(out).toBe("ID,Amount\r\n1,10\r\n");
    expect(onComplete).toHaveBeenCalledWith({ rows: 1, truncated: false });
  });

  it("truncates at maxRows", async () => {
    async function* rows() { for (let i = 0; i < 10; i++) yield { id: String(i), amount: i }; }
    const onComplete = jest.fn();
    const out = await readAll(createCsvStream(rows(), { columns, maxRows: 3, onComplete }));
    expect(out.trim().split("\r\n")).toHaveLength(4);
    expect(onComplete).toHaveBeenCalledWith({ rows: 3, truncated: true });
  });

  it("errors the stream when the source fails", async () => {
    async function* rows() { yield { id: "1", amount: 1 }; throw new Error("db down"); }
    await expect(readAll(createCsvStream(rows(), { columns }))).rejects.toThrow("db down");
  });
});

it("sets no-store attachment headers", () => {
  const h = exportResponseHeaders("contributions 2026");
  expect(h["Cache-Control"]).toContain("no-store");
  expect(h["Content-Disposition"]).toBe('attachment; filename="contributions_2026.csv"');
});

it("forbids every kind of caching and sandboxes the download", () => {
  const h = exportResponseHeaders("x");
  expect(h["Cache-Control"]).toBe("no-store, private");
  expect(h.Pragma).toBe("no-cache");
  expect(h.Expires).toBe("0");
  expect(h["X-Content-Type-Options"]).toBe("nosniff");
  expect(h["Content-Security-Policy"]).toContain("sandbox");
});
