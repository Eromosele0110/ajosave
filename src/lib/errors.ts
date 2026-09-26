/**
 * Centralized application error classes and factory helpers.
 *
 * Usage:
 *   throw notFound("Circle not found");
 *   throw validationError("Amount must be positive", { field: "amount" });
 *
 * In middleware, catch AppError instances to return structured API responses.
 */

// ─── AppError ─────────────────────────────────────────────────────────────────

export class AppError extends Error {
  /** Machine-readable error code, e.g. 'NOT_FOUND', 'VALIDATION_ERROR' */
  readonly code: string;
  /** HTTP status code */
  readonly statusCode: number;
  /** Optional structured details (field errors, context, etc.) */
  readonly details?: unknown;

  constructor(
    message: string,
    code: string,
    statusCode: number,
    details?: unknown
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;

    // Maintain proper prototype chain in transpiled code
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** Serialize to a plain object suitable for JSON API responses. */
  toJSON(): { success: false; error: string; code: string; details?: unknown } {
    const base: { success: false; error: string; code: string; details?: unknown } = {
      success: false,
      error: this.message,
      code: this.code,
    };
    if (this.details !== undefined) {
      base.details = this.details;
    }
    return base;
  }
}

// ─── Factory helpers ──────────────────────────────────────────────────────────

/**
 * 400 Bad Request — the request was malformed or missing required fields.
 */
export function badRequest(message = "Bad request", details?: unknown): AppError {
  return new AppError(message, "BAD_REQUEST", 400, details);
}

/**
 * 401 Unauthorized — the request lacks valid authentication credentials.
 */
export function unauthorized(message = "Unauthorized", details?: unknown): AppError {
  return new AppError(message, "UNAUTHORIZED", 401, details);
}

/**
 * 403 Forbidden — the authenticated user does not have permission.
 */
export function forbidden(message = "Forbidden", details?: unknown): AppError {
  return new AppError(message, "FORBIDDEN", 403, details);
}

/**
 * 404 Not Found — the requested resource does not exist.
 */
export function notFound(message = "Not found", details?: unknown): AppError {
  return new AppError(message, "NOT_FOUND", 404, details);
}

/**
 * 409 Conflict — the request conflicts with existing state (duplicate, already exists, etc.).
 */
export function conflict(message = "Conflict", details?: unknown): AppError {
  return new AppError(message, "CONFLICT", 409, details);
}

/**
 * 422 Unprocessable Entity — input validation failed with field-level details.
 */
export function validationError(message = "Validation error", details?: unknown): AppError {
  return new AppError(message, "VALIDATION_ERROR", 422, details);
}

/**
 * 429 Too Many Requests — rate limit exceeded.
 */
export function tooManyRequests(message = "Too many requests", details?: unknown): AppError {
  return new AppError(message, "RATE_LIMITED", 429, details);
}

/**
 * 500 Internal Server Error — an unexpected server-side error occurred.
 */
export function internalError(message = "Internal server error", details?: unknown): AppError {
  return new AppError(message, "INTERNAL_ERROR", 500, details);
}

// ─── Type guard ───────────────────────────────────────────────────────────────

/** Narrows an unknown thrown value to AppError. */
export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
