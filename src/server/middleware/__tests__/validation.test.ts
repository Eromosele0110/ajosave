jest.mock("next/server", () => ({
  NextRequest: class {},
  NextResponse: {
    json: jest.fn((body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    })),
  },
}));

import { z } from "zod";
import { NextResponse } from "next/server";
import { withValidation, queryToObject } from "../validation";

function makeReq(
  body?: string,
  { url = "http://localhost/api/x", contentType = "application/json" } = {}
) {
  const headers = new Map<string, string>();
  if (contentType) headers.set("content-type", contentType);
  if (body !== undefined) headers.set("content-length", String(body.length));
  return {
    url,
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    text: async () => body ?? "",
  } as never;
}

const bodySchema = z.object({
  amount: z.number().positive().max(1_000_000),
  circleId: z.string().uuid(),
});
const ok = () => jest.fn(async (_req: unknown, input: unknown) => NextResponse.json(input));
const ID = "3f1c2a52-8a51-4f7e-9d1e-6d3a0c1b2e4f";

describe("withValidation", () => {
  it("passes parsed body to the handler", async () => {
    const res = (await withValidation(
      { body: bodySchema },
      ok()
    )(makeReq(JSON.stringify({ amount: 50, circleId: ID })))) as any;
    expect(res.status).toBe(200);
    expect(res.body.body).toEqual({ amount: 50, circleId: ID });
  });

  it("rejects invalid fields with 400 and per-field details", async () => {
    const handler = ok();
    const res = (await withValidation(
      { body: bodySchema },
      handler
    )(makeReq(JSON.stringify({ amount: -1, circleId: "nope" })))) as any;
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.details.map((d: any) => d.path).sort()).toEqual(["amount", "circleId"]);
    expect(handler).not.toHaveBeenCalled();
  });

  it("enforces amount boundaries", async () => {
    const run = async (amount: number) =>
      (
        (await withValidation(
          { body: bodySchema },
          ok()
        )(makeReq(JSON.stringify({ amount, circleId: ID })))) as any
      ).status;
    expect(await run(0)).toBe(400);
    expect(await run(1_000_000)).toBe(200);
    expect(await run(1_000_001)).toBe(400);
  });

  it("rejects malformed JSON, wrong content type and empty bodies", async () => {
    const h = withValidation({ body: bodySchema }, ok());
    expect(((await h(makeReq("{bad"))) as any).body.error).toBe("Malformed JSON body");
    expect(((await h(makeReq("{}", { contentType: "text/plain" }))) as any).status).toBe(400);
    expect(((await h(makeReq(""))) as any).status).toBe(400);
  });

  it("rejects oversized bodies with 413", async () => {
    const res = (await withValidation({ body: bodySchema }, ok(), { maxBodyBytes: 10 })(
      makeReq(JSON.stringify({ amount: 1, circleId: ID }))
    )) as any;
    expect(res.status).toBe(413);
    expect(res.body.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("validates query and params together and reports every source", async () => {
    const h = withValidation(
      {
        query: z.object({ page: z.coerce.number().int().min(1) }),
        params: z.object({ id: z.string().uuid() }),
      },
      ok()
    );
    const bad = (await h(
      makeReq(undefined, { url: "http://localhost/api/x?page=0", contentType: "" }),
      {
        params: { id: "x" },
      }
    )) as any;
    expect(bad.status).toBe(400);
    expect(bad.body.details.map((d: any) => d.source).sort()).toEqual(["params", "query"]);

    const good = (await h(
      makeReq(undefined, { url: "http://localhost/api/x?page=2", contentType: "" }),
      {
        params: { id: ID },
      }
    )) as any;
    expect(good.status).toBe(200);
    expect(good.body.query).toEqual({ page: 2 });
  });

  it("turns repeated query keys into arrays", () => {
    expect(queryToObject(new URLSearchParams("a=1&a=2&b=3"))).toEqual({ a: ["1", "2"], b: "3" });
  });
});
