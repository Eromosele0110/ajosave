/**
 * @jest-environment node
 */
import { checkCsrf, isCsrfExempt, resolveAllowedOrigins, sourceOrigin } from "../csrf";

const APP = "https://ajosave.app";
const ALLOWED = ["https://ajosave.app", "https://partner.example"];

function headers(init: Record<string, string> = {}) {
  const h = new Headers(init);
  return { get: (name: string) => h.get(name) };
}

function check(method: string, pathname: string, init: Record<string, string> = {}) {
  return checkCsrf({
    method,
    pathname,
    headers: headers(init),
    requestOrigin: APP,
    allowedOrigins: ALLOWED,
  });
}

describe("checkCsrf", () => {
  it("never blocks safe methods", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(
        check(method, "/api/v1/circles", { cookie: "s=1", origin: "https://evil.example" }).ok
      ).toBe(true);
    }
  });

  it("blocks a cookie-authenticated mutation from a foreign origin", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(
        check(method, "/api/users/me", { cookie: "s=1", origin: "https://evil.example" })
      ).toEqual({
        ok: false,
        reason: "origin-mismatch",
      });
    }
  });

  it("blocks the opaque 'null' origin", () => {
    expect(check("POST", "/api/v1/circles", { cookie: "s=1", origin: "null" }).ok).toBe(false);
  });

  it("allows the app's own origin and configured origins", () => {
    expect(check("POST", "/api/v1/circles", { cookie: "s=1", origin: APP }).ok).toBe(true);
    expect(
      check("POST", "/api/v1/circles", { cookie: "s=1", origin: "https://partner.example" }).ok
    ).toBe(true);
  });

  it("allows the request's own origin even when it is not in the allow list", () => {
    const res = checkCsrf({
      method: "POST",
      pathname: "/api/v1/circles",
      headers: headers({ cookie: "s=1", origin: "https://preview-123.vercel.app" }),
      requestOrigin: "https://preview-123.vercel.app",
      allowedOrigins: ALLOWED,
    });
    expect(res.ok).toBe(true);
  });

  it("falls back to the Referer origin when Origin is absent", () => {
    expect(
      check("POST", "/api/v1/circles", { cookie: "s=1", referer: `${APP}/circles/1` }).ok
    ).toBe(true);
    expect(
      check("POST", "/api/v1/circles", { cookie: "s=1", referer: "https://evil.example/x" }).ok
    ).toBe(false);
  });

  it("uses Fetch Metadata only when neither Origin nor Referer is present", () => {
    expect(
      check("POST", "/api/v1/circles", { cookie: "s=1", "sec-fetch-site": "same-origin" }).ok
    ).toBe(true);
    expect(
      check("POST", "/api/v1/circles", { cookie: "s=1", "sec-fetch-site": "cross-site" })
    ).toEqual({
      ok: false,
      reason: "missing-origin",
    });
    expect(check("POST", "/api/v1/circles", { cookie: "s=1" })).toEqual({
      ok: false,
      reason: "missing-origin",
    });
  });

  it("does not let Fetch Metadata override a mismatched Origin", () => {
    expect(
      check("POST", "/api/v1/circles", {
        cookie: "s=1",
        origin: "https://evil.example",
        "sec-fetch-site": "same-origin",
      }).ok
    ).toBe(false);
  });

  it("treats an unparseable Referer as missing", () => {
    expect(check("POST", "/api/v1/circles", { cookie: "s=1", referer: "not a url" }).ok).toBe(
      false
    );
  });

  it("does not check bearer-token requests", () => {
    expect(
      check("POST", "/api/v1/circles", {
        cookie: "s=1",
        authorization: "Bearer abc",
        origin: "https://evil.example",
      }).ok
    ).toBe(true);
  });

  it("does not check requests without cookies", () => {
    expect(check("POST", "/api/v1/auth/send-otp", { origin: "https://evil.example" }).ok).toBe(
      true
    );
    expect(check("POST", "/api/v1/auth/send-otp", { cookie: "   " }).ok).toBe(true);
  });

  it("exempts webhooks and NextAuth built-in routes", () => {
    const foreign = { cookie: "s=1", origin: "https://evil.example" };
    expect(check("POST", "/api/v1/webhooks/paystack", foreign).ok).toBe(true);
    expect(check("POST", "/api/webhooks/termii", foreign).ok).toBe(true);
    expect(check("POST", "/api/v1/kyc/webhook", foreign).ok).toBe(true);
    expect(check("POST", "/api/auth/callback/credentials", foreign).ok).toBe(true);
  });

  it("still checks the app's own auth mutations, which are not NextAuth routes", () => {
    const foreign = { cookie: "refreshToken=x", origin: "https://evil.example" };
    expect(check("POST", "/api/v1/auth/refresh", foreign).ok).toBe(false);
    expect(check("POST", "/api/auth/logout", foreign).ok).toBe(false);
  });
});

describe("isCsrfExempt", () => {
  it("matches only the intended paths", () => {
    expect(isCsrfExempt("/api/v1/webhooks/paystack")).toBe(true);
    expect(isCsrfExempt("/api/v1/circles")).toBe(false);
    expect(isCsrfExempt("/api/v1/auth/send-otp")).toBe(false);
  });
});

describe("sourceOrigin", () => {
  it("prefers Origin over Referer", () => {
    expect(sourceOrigin(headers({ origin: APP, referer: "https://other.example/x" }))).toBe(APP);
  });
  it("returns null with neither header", () => {
    expect(sourceOrigin(headers())).toBeNull();
  });
});

describe("resolveAllowedOrigins", () => {
  it("merges configured origins, trims and strips trailing slashes", () => {
    const origins = resolveAllowedOrigins({
      ALLOWED_ORIGINS: " https://a.example/ ,https://b.example",
      NEXT_PUBLIC_APP_URL: "https://app.example/",
    });
    expect(origins).toEqual(
      expect.arrayContaining(["https://a.example", "https://b.example", "https://app.example", APP])
    );
  });
  it("always includes the production origins", () => {
    expect(resolveAllowedOrigins({})).toEqual(
      expect.arrayContaining([APP, "https://www.ajosave.app"])
    );
  });
});
