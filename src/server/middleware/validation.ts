import { NextRequest, NextResponse } from "next/server";
import type { ZodIssue, ZodTypeAny, z } from "zod";
import type { ApiError } from "@/types";

/**
 * Route input validation.
 *
 * Parses and validates the JSON body, query string and route params against
 * zod schemas before the handler runs. Invalid input is rejected with a
 * consistent 400 `VALIDATION_ERROR` response listing each failing field, so
 * handlers only ever see typed, validated data.
 *
 * Usage:
 *   export const POST = withValidation(
 *     { body: z.object({ amount: z.number().positive() }) },
 *     async (req, { body }) => NextResponse.json({ ok: true, amount: body.amount })
 *   );
 */

export const MAX_JSON_BODY_BYTES = 100 * 1024;

export interface ValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

type Infer<S> = S extends ZodTypeAny ? z.infer<S> : undefined;

export interface ValidatedInput<S extends ValidationSchemas> {
  body: Infer<S["body"]>;
  query: Infer<S["query"]>;
  params: Infer<S["params"]>;
}

export interface FieldError {
  source: "body" | "query" | "params";
  path: string;
  message: string;
}

type RouteHandler = (_req: NextRequest, _ctx?: any) => Promise<NextResponse>;

function invalid(error: string, details?: FieldError[], status = 400): NextResponse {
  const body: ApiError & { details?: FieldError[] } = {
    success: false,
    error,
    code: status === 413 ? "PAYLOAD_TOO_LARGE" : "VALIDATION_ERROR",
  };
  if (details) body.details = details;
  return NextResponse.json(body, { status });
}

export function formatIssues(source: FieldError["source"], issues: ZodIssue[]): FieldError[] {
  return issues.map((issue) => ({
    source,
    path: issue.path.join(".") || "(root)",
    message: issue.message,
  }));
}

/** Convert a query string into an object; repeated keys become arrays. */
export function queryToObject(params: URLSearchParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  params.forEach((value, key) => {
    const existing = out[key];
    if (existing === undefined) out[key] = value;
    else out[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
  });
  return out;
}

export function withValidation<S extends ValidationSchemas>(
  schemas: S,
  handler: (_req: NextRequest, _input: ValidatedInput<S>, _ctx?: any) => Promise<NextResponse>,
  { maxBodyBytes = MAX_JSON_BODY_BYTES }: { maxBodyBytes?: number } = {}
): RouteHandler {
  return async (req, ctx) => {
    const errors: FieldError[] = [];
    const input = { body: undefined, query: undefined, params: undefined } as ValidatedInput<S>;

    if (schemas.body) {
      const contentType = req.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().includes("application/json")) {
        return invalid("Content-Type must be application/json");
      }
      const declared = Number(req.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > maxBodyBytes) {
        return invalid("Request body too large", undefined, 413);
      }
      const raw = await req.text();
      if (new TextEncoder().encode(raw).length > maxBodyBytes) {
        return invalid("Request body too large", undefined, 413);
      }
      let json: unknown;
      try {
        json = raw.length ? JSON.parse(raw) : undefined;
      } catch {
        return invalid("Malformed JSON body");
      }
      const parsed = schemas.body.safeParse(json);
      if (parsed.success) input.body = parsed.data;
      else errors.push(...formatIssues("body", parsed.error.issues));
    }

    if (schemas.query) {
      const parsed = schemas.query.safeParse(queryToObject(new URL(req.url).searchParams));
      if (parsed.success) input.query = parsed.data;
      else errors.push(...formatIssues("query", parsed.error.issues));
    }

    if (schemas.params) {
      const rawParams = await Promise.resolve(ctx?.params ?? {});
      const parsed = schemas.params.safeParse(rawParams);
      if (parsed.success) input.params = parsed.data;
      else errors.push(...formatIssues("params", parsed.error.issues));
    }

    if (errors.length) return invalid("Invalid request input", errors);
    return handler(req, input, ctx);
  };
}
