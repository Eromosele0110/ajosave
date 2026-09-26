import {
  AppError,
  isAppError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  validationError,
  tooManyRequests,
  internalError,
} from "@/lib/errors";

// ─── AppError class ───────────────────────────────────────────────────────────

describe("AppError", () => {
  it("is an instance of Error", () => {
    const err = new AppError("Something went wrong", "SOME_CODE", 500);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
  });

  it("sets name to AppError", () => {
    const err = new AppError("msg", "CODE", 400);
    expect(err.name).toBe("AppError");
  });

  it("stores message, code, and statusCode", () => {
    const err = new AppError("Not found", "NOT_FOUND", 404);
    expect(err.message).toBe("Not found");
    expect(err.code).toBe("NOT_FOUND");
    expect(err.statusCode).toBe(404);
  });

  it("stores optional details", () => {
    const details = { field: "email", reason: "invalid format" };
    const err = new AppError("Validation failed", "VALIDATION_ERROR", 422, details);
    expect(err.details).toEqual(details);
  });

  it("details is undefined when not provided", () => {
    const err = new AppError("msg", "CODE", 400);
    expect(err.details).toBeUndefined();
  });

  it("maintains correct prototype chain (instanceof works across transpilation)", () => {
    const err = new AppError("msg", "CODE", 400);
    expect(err instanceof AppError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });

  it("has a stack trace", () => {
    const err = new AppError("msg", "CODE", 400);
    expect(err.stack).toBeDefined();
    expect(typeof err.stack).toBe("string");
  });

  describe("toJSON()", () => {
    it("returns success: false with error and code", () => {
      const err = new AppError("Not found", "NOT_FOUND", 404);
      expect(err.toJSON()).toEqual({
        success: false,
        error: "Not found",
        code: "NOT_FOUND",
      });
    });

    it("includes details when present", () => {
      const details = { field: "amount" };
      const err = new AppError("Validation error", "VALIDATION_ERROR", 422, details);
      expect(err.toJSON()).toEqual({
        success: false,
        error: "Validation error",
        code: "VALIDATION_ERROR",
        details,
      });
    });

    it("omits details key when not provided", () => {
      const err = new AppError("Not found", "NOT_FOUND", 404);
      const json = err.toJSON();
      expect(Object.prototype.hasOwnProperty.call(json, "details")).toBe(false);
    });
  });
});

// ─── Factory helpers ──────────────────────────────────────────────────────────

describe("badRequest()", () => {
  it("creates a 400 AppError with BAD_REQUEST code", () => {
    const err = badRequest();
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe("BAD_REQUEST");
  });

  it("uses default message", () => {
    expect(badRequest().message).toBe("Bad request");
  });

  it("accepts custom message and details", () => {
    const err = badRequest("Missing field", { field: "phone" });
    expect(err.message).toBe("Missing field");
    expect(err.details).toEqual({ field: "phone" });
  });
});

describe("unauthorized()", () => {
  it("creates a 401 AppError with UNAUTHORIZED code", () => {
    const err = unauthorized();
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe("UNAUTHORIZED");
  });

  it("uses default message", () => {
    expect(unauthorized().message).toBe("Unauthorized");
  });

  it("accepts custom message", () => {
    const err = unauthorized("Token expired");
    expect(err.message).toBe("Token expired");
  });
});

describe("forbidden()", () => {
  it("creates a 403 AppError with FORBIDDEN code", () => {
    const err = forbidden();
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe("FORBIDDEN");
  });

  it("uses default message", () => {
    expect(forbidden().message).toBe("Forbidden");
  });
});

describe("notFound()", () => {
  it("creates a 404 AppError with NOT_FOUND code", () => {
    const err = notFound();
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
  });

  it("uses default message", () => {
    expect(notFound().message).toBe("Not found");
  });

  it("accepts custom message", () => {
    const err = notFound("Circle not found");
    expect(err.message).toBe("Circle not found");
  });
});

describe("conflict()", () => {
  it("creates a 409 AppError with CONFLICT code", () => {
    const err = conflict();
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe("CONFLICT");
  });

  it("uses default message", () => {
    expect(conflict().message).toBe("Conflict");
  });

  it("accepts custom message and details", () => {
    const err = conflict("Member already in circle", { memberId: "123" });
    expect(err.message).toBe("Member already in circle");
    expect(err.details).toEqual({ memberId: "123" });
  });
});

describe("validationError()", () => {
  it("creates a 422 AppError with VALIDATION_ERROR code", () => {
    const err = validationError();
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe("VALIDATION_ERROR");
  });

  it("uses default message", () => {
    expect(validationError().message).toBe("Validation error");
  });

  it("accepts field-level details", () => {
    const details = { fields: { amount: "Must be positive", name: "Required" } };
    const err = validationError("Invalid input", details);
    expect(err.details).toEqual(details);
  });
});

describe("tooManyRequests()", () => {
  it("creates a 429 AppError with RATE_LIMITED code", () => {
    const err = tooManyRequests();
    expect(err.statusCode).toBe(429);
    expect(err.code).toBe("RATE_LIMITED");
  });

  it("uses default message", () => {
    expect(tooManyRequests().message).toBe("Too many requests");
  });
});

describe("internalError()", () => {
  it("creates a 500 AppError with INTERNAL_ERROR code", () => {
    const err = internalError();
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe("INTERNAL_ERROR");
  });

  it("uses default message", () => {
    expect(internalError().message).toBe("Internal server error");
  });

  it("accepts custom message", () => {
    const err = internalError("Database unreachable");
    expect(err.message).toBe("Database unreachable");
  });
});

// ─── isAppError type guard ────────────────────────────────────────────────────

describe("isAppError()", () => {
  it("returns true for AppError instances", () => {
    expect(isAppError(new AppError("msg", "CODE", 400))).toBe(true);
    expect(isAppError(notFound())).toBe(true);
    expect(isAppError(internalError())).toBe(true);
  });

  it("returns false for plain Error instances", () => {
    expect(isAppError(new Error("plain error"))).toBe(false);
  });

  it("returns false for non-error values", () => {
    expect(isAppError(null)).toBe(false);
    expect(isAppError(undefined)).toBe(false);
    expect(isAppError("string error")).toBe(false);
    expect(isAppError(42)).toBe(false);
    expect(isAppError({ message: "fake", code: "FAKE" })).toBe(false);
  });
});
