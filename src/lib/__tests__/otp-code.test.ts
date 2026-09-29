/**
 * @jest-environment node
 */
import { OTP_LENGTH, generateOtp, otpMatches } from "../otp-code";

describe("generateOtp", () => {
  it("returns a 6-digit numeric string without a leading zero", () => {
    for (let i = 0; i < 500; i++) {
      const otp = generateOtp();
      expect(otp).toMatch(/^[1-9]\d{5}$/);
      expect(otp).toHaveLength(OTP_LENGTH);
    }
  });

  it("does not depend on Math.random", () => {
    const spy = jest.spyOn(Math, "random").mockReturnValue(0);
    try {
      const seen = new Set(Array.from({ length: 50 }, () => generateOtp()));
      expect(seen.size).toBeGreaterThan(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("otpMatches", () => {
  it("matches identical codes", () => {
    expect(otpMatches("123456", "123456")).toBe(true);
  });

  it("rejects a different code of the same length", () => {
    expect(otpMatches("123456", "123457")).toBe(false);
    expect(otpMatches("123456", "023456")).toBe(false);
  });

  it("rejects codes of a different length instead of throwing", () => {
    expect(otpMatches("123456", "12345")).toBe(false);
    expect(otpMatches("123456", "1234567")).toBe(false);
    expect(otpMatches("123456", "")).toBe(false);
  });

  it("never matches when no code is stored", () => {
    expect(otpMatches(null, "123456")).toBe(false);
    expect(otpMatches(undefined, "123456")).toBe(false);
    expect(otpMatches("", "")).toBe(false);
  });
});
