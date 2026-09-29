/**
 * @jest-environment node
 */
import {
  OTP_MAX_SENDS_PER_IP_PER_HOUR,
  OTP_MAX_SENDS_PER_PHONE_PER_DAY,
  OTP_RESEND_COOLDOWN_SECONDS,
  checkOtpSendAllowed,
  getClientIp,
  maskPhone,
  releaseOtpSendCooldown,
} from "../otp-abuse";
import { getRedis } from "../redis";

jest.mock("../redis");
jest.mock("../logger", () => ({
  __esModule: true,
  default: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

const PHONE = "+2348012345678";
const IP = "203.0.113.9";

/** In-memory Redis with just the commands the module uses, with TTL bookkeeping. */
function fakeRedis() {
  const store = new Map<string, { value: string; ttl: number }>();
  return {
    store,
    set: jest.fn(async (key: string, value: string, opts?: { NX?: boolean; EX?: number }) => {
      if (opts?.NX && store.has(key)) return null;
      store.set(key, { value, ttl: opts?.EX ?? -1 });
      return "OK";
    }),
    incr: jest.fn(async (key: string) => {
      const cur = store.get(key);
      const next = Number(cur?.value ?? 0) + 1;
      store.set(key, { value: String(next), ttl: cur?.ttl ?? -1 });
      return next;
    }),
    expire: jest.fn(async (key: string, seconds: number) => {
      const cur = store.get(key);
      if (cur) cur.ttl = seconds;
      return 1;
    }),
    ttl: jest.fn(async (key: string) => store.get(key)?.ttl ?? -2),
    del: jest.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
  };
}

let redis: ReturnType<typeof fakeRedis>;

beforeEach(() => {
  redis = fakeRedis();
  (getRedis as jest.Mock).mockResolvedValue(redis);
});

describe("checkOtpSendAllowed", () => {
  it("allows the first send and arms the cooldown", async () => {
    await expect(checkOtpSendAllowed(PHONE, IP)).resolves.toEqual({ allowed: true });
    expect(redis.set).toHaveBeenCalledWith(`otp_cooldown:${PHONE}`, "1", {
      NX: true,
      EX: OTP_RESEND_COOLDOWN_SECONDS,
    });
  });

  it("denies an immediate resend with the remaining cooldown", async () => {
    await checkOtpSendAllowed(PHONE, IP);
    redis.store.get(`otp_cooldown:${PHONE}`)!.ttl = 41;
    const res = await checkOtpSendAllowed(PHONE, IP);
    expect(res).toMatchObject({ allowed: false, reason: "cooldown", retryAfterSeconds: 41 });
  });

  it("does not spend the daily or IP quota on a cooldown denial", async () => {
    await checkOtpSendAllowed(PHONE, IP);
    await checkOtpSendAllowed(PHONE, IP);
    expect(redis.store.get(`otp_daily:${PHONE}`)?.value).toBe("1");
    expect(redis.store.get(`otp_ip:${IP}`)?.value).toBe("1");
  });

  it("allows another send once the cooldown has expired", async () => {
    await checkOtpSendAllowed(PHONE, IP);
    redis.store.delete(`otp_cooldown:${PHONE}`);
    await expect(checkOtpSendAllowed(PHONE, IP)).resolves.toEqual({ allowed: true });
  });

  it("caps sends per phone per day and reports when the window ends", async () => {
    for (let i = 0; i < OTP_MAX_SENDS_PER_PHONE_PER_DAY; i++) {
      redis.store.delete(`otp_cooldown:${PHONE}`);
      expect(await checkOtpSendAllowed(PHONE, `198.51.100.${i}`)).toEqual({ allowed: true });
    }
    redis.store.delete(`otp_cooldown:${PHONE}`);
    redis.store.get(`otp_daily:${PHONE}`)!.ttl = 3600;
    const res = await checkOtpSendAllowed(PHONE, "198.51.100.200");
    expect(res).toMatchObject({
      allowed: false,
      reason: "phone-daily-limit",
      retryAfterSeconds: 3600,
    });
  });

  it("sets the daily window only when the counter is created", async () => {
    await checkOtpSendAllowed(PHONE, IP);
    redis.store.delete(`otp_cooldown:${PHONE}`);
    await checkOtpSendAllowed(PHONE, IP);
    const dailyExpires = redis.expire.mock.calls.filter(([key]) => key === `otp_daily:${PHONE}`);
    expect(dailyExpires).toEqual([[`otp_daily:${PHONE}`, 24 * 60 * 60]]);
  });

  it("caps sends per IP per hour across different phone numbers", async () => {
    for (let i = 0; i < OTP_MAX_SENDS_PER_IP_PER_HOUR; i++) {
      expect(await checkOtpSendAllowed(`+23480000000${String(i).padStart(2, "0")}`, IP)).toEqual({
        allowed: true,
      });
    }
    const res = await checkOtpSendAllowed("+2348099999999", IP);
    expect(res).toMatchObject({ allowed: false, reason: "ip-hourly-limit" });
  });

  it("skips the IP cap when the client IP is unknown", async () => {
    for (let i = 0; i < OTP_MAX_SENDS_PER_IP_PER_HOUR + 5; i++) {
      const res = await checkOtpSendAllowed(`+23480000000${String(i).padStart(2, "0")}`, "unknown");
      expect(res).toEqual({ allowed: true });
    }
    expect(redis.store.has("otp_ip:unknown")).toBe(false);
  });

  it("propagates Redis failures instead of allowing the send", async () => {
    redis.set.mockRejectedValueOnce(new Error("redis down"));
    await expect(checkOtpSendAllowed(PHONE, IP)).rejects.toThrow("redis down");
  });
});

describe("releaseOtpSendCooldown", () => {
  it("lets the user retry immediately", async () => {
    await checkOtpSendAllowed(PHONE, IP);
    await releaseOtpSendCooldown(PHONE);
    expect(redis.store.has(`otp_cooldown:${PHONE}`)).toBe(false);
  });
});

describe("getClientIp", () => {
  const h = (init: Record<string, string>) => {
    const headers = new Headers(init);
    return { get: (name: string) => headers.get(name) };
  };
  it("uses the first x-forwarded-for entry", () => {
    expect(getClientIp(h({ "x-forwarded-for": " 203.0.113.9 , 10.0.0.1" }))).toBe("203.0.113.9");
  });
  it("falls back to x-real-ip, then unknown", () => {
    expect(getClientIp(h({ "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
    expect(getClientIp(h({}))).toBe("unknown");
  });
});

describe("maskPhone", () => {
  it("hides the middle digits", () => {
    expect(maskPhone(PHONE)).toBe("+234*******678");
    expect(maskPhone(PHONE)).not.toContain("8012345");
  });
  it("fully masks very short values", () => {
    expect(maskPhone("+2341")).toBe("***");
  });
});
