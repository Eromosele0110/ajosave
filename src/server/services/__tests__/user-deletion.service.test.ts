import {
  deleteUserData,
  phoneKeyedRedisKeys,
  sendDeletionConfirmationEmail,
} from "@/server/services/user-deletion.service";
import * as db from "@/lib/db";
import * as sessions from "@/lib/sessions";
import * as redisLib from "@/lib/redis";
import * as email from "@/lib/email";
import * as audit from "@/server/services/audit.service";

jest.mock("@/lib/db", () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn() }));
jest.mock("@/server/services/audit.service", () => ({ logAuditAction: jest.fn() }));
jest.mock("@/lib/sessions", () => ({ revokeAllSessions: jest.fn() }));
jest.mock("@/lib/redis", () => ({ getRedis: jest.fn() }));

const mockTransaction = db.transaction as jest.MockedFunction<typeof db.transaction>;
const mockQuery = db.query as jest.MockedFunction<typeof db.query>;
const mockSendEmail = email.sendEmail as jest.MockedFunction<typeof email.sendEmail>;
const mockLogAudit = audit.logAuditAction as jest.MockedFunction<typeof audit.logAuditAction>;
const mockRevokeAll = sessions.revokeAllSessions as jest.MockedFunction<typeof sessions.revokeAllSessions>;
const mockGetRedis = redisLib.getRedis as jest.MockedFunction<typeof redisLib.getRedis>;
const mockRedisDel = jest.fn();

const USER_ID = "abc12345-0000-0000-0000-000000000000";

beforeEach(() => {
  jest.clearAllMocks();
  mockLogAudit.mockResolvedValue({} as any);
  mockTransaction.mockImplementation(async (cb) => cb(mockQuery));
  mockRevokeAll.mockResolvedValue(0);
  mockRedisDel.mockResolvedValue(5);
  mockGetRedis.mockResolvedValue({ del: mockRedisDel } as any);
});

describe("deleteUserData", () => {
  it("anonymizes PII and returns email", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ email: "user@example.com" }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any) // UPDATE users
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any); // DELETE refresh_tokens

    const result = await deleteUserData(USER_ID);

    expect(result).toEqual({ email: "user@example.com" });
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE users"),
      expect.arrayContaining([`deleted-${USER_ID}`, `deleted-user-${USER_ID.slice(0, 8)}`, USER_ID])
    );
    expect(mockQuery).toHaveBeenCalledWith(
      "DELETE FROM refresh_tokens WHERE user_id = $1",
      [USER_ID]
    );
  });

  it("returns null email when user has no email", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ email: null }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const result = await deleteUserData(USER_ID);
    expect(result.email).toBeNull();
  });

  it("throws if user not found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    await expect(deleteUserData(USER_ID)).rejects.toThrow("User not found");
  });

  it("logs audit action after deletion", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ email: null }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    await deleteUserData(USER_ID);

    expect(mockLogAudit).toHaveBeenCalledWith(
      USER_ID, "DELETE_USER", "USER", USER_ID,
      expect.objectContaining({ details: expect.objectContaining({ reason: expect.stringContaining("GDPR") }) })
    );
  });

  it("does not throw if audit log fails", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ email: null }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    mockLogAudit.mockRejectedValue(new Error("audit DB down"));

    await expect(deleteUserData(USER_ID)).resolves.toBeDefined();
  });
});

describe("deleteUserData — residue cleanup (#110)", () => {
  const PHONE = "+2348012345678";

  function mockHappyDb(phone: string | null = PHONE) {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ email: "user@example.com", phone }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
  }

  it("revokes every session of the deleted user", async () => {
    mockHappyDb();
    await deleteUserData(USER_ID);
    expect(mockRevokeAll).toHaveBeenCalledWith(USER_ID);
  });

  it("purges all phone-keyed Redis state using the phone read before anonymization", async () => {
    mockHappyDb();
    await deleteUserData(USER_ID);
    expect(mockRedisDel).toHaveBeenCalledWith(phoneKeyedRedisKeys(PHONE));
    expect(phoneKeyedRedisKeys(PHONE)).toEqual([
      `otp:${PHONE}`,
      `lockout:${PHONE}`,
      `otp_failures:${PHONE}`,
      `otp_cooldown:${PHONE}`,
      `otp_daily:${PHONE}`,
    ]);
  });

  it("skips the Redis purge when there is no usable phone", async () => {
    mockHappyDb(null);
    await deleteUserData(USER_ID);
    mockHappyDb(`deleted-${USER_ID}`);
    await deleteUserData(USER_ID);
    expect(mockRedisDel).not.toHaveBeenCalled();
  });

  it("still succeeds when session revocation or the Redis purge fails", async () => {
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      mockHappyDb();
      mockRevokeAll.mockRejectedValueOnce(new Error("db down"));
      mockRedisDel.mockRejectedValueOnce(new Error("redis down"));
      await expect(deleteUserData(USER_ID)).resolves.toEqual({ email: "user@example.com" });
      expect(errSpy).toHaveBeenCalledTimes(2);
    } finally {
      errSpy.mockRestore();
    }
  });

  it("does not touch sessions or Redis when the user does not exist", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    await expect(deleteUserData(USER_ID)).rejects.toThrow("User not found");
    expect(mockRevokeAll).not.toHaveBeenCalled();
    expect(mockRedisDel).not.toHaveBeenCalled();
  });
});

describe("sendDeletionConfirmationEmail", () => {
  it("sends email with correct subject and recipient", async () => {
    mockSendEmail.mockResolvedValue(undefined);
    await sendDeletionConfirmationEmail("user@example.com");
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "user@example.com",
        subject: "Your Ajosave account has been deleted",
      })
    );
  });
});
