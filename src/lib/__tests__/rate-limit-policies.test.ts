import { resolveRateLimitPolicy, rateLimitKey, DEFAULT_POLICY } from "../rate-limit-policies";

describe("resolveRateLimitPolicy", () => {
  it("applies strict OTP policy", () => {
    expect(resolveRateLimitPolicy("post", "/api/v1/auth/send-otp").name).toBe("auth-otp");
  });
  it("ignores trailing slashes", () => {
    expect(resolveRateLimitPolicy("POST", "/api/auth/verify-otp/").name).toBe("auth-otp");
  });
  it("respects method restrictions", () => {
    expect(resolveRateLimitPolicy("GET", "/api/v1/auth/send-otp")).toBe(DEFAULT_POLICY);
  });
  it("matches export and admin routes", () => {
    expect(resolveRateLimitPolicy("GET", "/api/v1/admin/export").name).toBe("exports");
    expect(resolveRateLimitPolicy("GET", "/api/v1/admin/users").name).toBe("admin");
  });
  it("falls back to default", () => {
    expect(resolveRateLimitPolicy("GET", "/api/v1/circles")).toBe(DEFAULT_POLICY);
  });
});

describe("rateLimitKey", () => {
  const userPolicy = resolveRateLimitPolicy("GET", "/api/v1/admin/users");
  it("keys by user when available", () => {
    expect(rateLimitKey(userPolicy, "1.2.3.4", "u1")).toBe("admin:u:u1");
  });
  it("falls back to ip without user", () => {
    expect(rateLimitKey(userPolicy, "1.2.3.4", null)).toBe("admin:ip:1.2.3.4");
    expect(rateLimitKey(DEFAULT_POLICY, "")).toBe("default:ip:unknown");
  });
});
