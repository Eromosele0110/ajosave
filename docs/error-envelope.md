# Standard Error Envelope

Every error response from the STELLAR API follows a single, consistent shape — the **error envelope**. This document describes the format, the error codes in use, and how to throw structured errors from application code.

---

## Response shape

```jsonc
{
  "success": false,
  "error": "Human-readable description of what went wrong",
  "code": "MACHINE_READABLE_CODE",
  // Optional — present when the error carries structured context
  "details": { ... }
}
```

| Field     | Type            | Always present | Description                                                          |
| --------- | --------------- | -------------- | -------------------------------------------------------------------- |
| `success` | `false`         | ✓              | Discriminant — always `false` for errors.                            |
| `error`   | `string`        | ✓              | User-facing message. Safe to display. Never exposes internal details.|
| `code`    | `string`        | ✓              | Machine-readable code. Use this in client `switch` statements.       |
| `details` | `object\|array` | ✗              | Optional structured context, e.g. field-level validation failures.   |

The `x-correlation-id` header is always set on error responses and matches the value echoed from the request (or a newly generated UUID when absent). Use it when filing bug reports.

---

## Standard error codes

| Code               | HTTP Status | Factory helper      | Meaning                                               |
| ------------------ | ----------- | ------------------- | ----------------------------------------------------- |
| `BAD_REQUEST`      | 400         | `badRequest()`      | Malformed request or missing required fields.         |
| `UNAUTHORIZED`     | 401         | `unauthorized()`    | Missing or invalid authentication credentials.        |
| `FORBIDDEN`        | 403         | `forbidden()`       | Authenticated but lacking the required permission.    |
| `NOT_FOUND`        | 404         | `notFound()`        | The requested resource does not exist.                |
| `CONFLICT`         | 409         | `conflict()`        | State conflict — duplicate join, already paid, etc.   |
| `VALIDATION_ERROR` | 422         | `validationError()` | Input failed schema validation. Check `details`.      |
| `RATE_LIMITED`     | 429         | `tooManyRequests()` | Too many requests in the sliding window.              |
| `INTERNAL_ERROR`   | 500         | `internalError()`   | Unexpected server-side error.                         |

---

## Examples

### 404 Not Found

```jsonc
// HTTP 404
{
  "success": false,
  "error": "Circle not found",
  "code": "NOT_FOUND"
}
```

### 422 Validation Error (with field details)

```jsonc
// HTTP 422
{
  "success": false,
  "error": "Invalid input",
  "code": "VALIDATION_ERROR",
  "details": {
    "fields": {
      "contributionUsdc": "Must be a positive number",
      "maxMembers": "Must be between 2 and 20"
    }
  }
}
```

### 409 Conflict

```jsonc
// HTTP 409
{
  "success": false,
  "error": "You are already a member of this circle",
  "code": "CONFLICT"
}
```

### 500 Internal Server Error

```jsonc
// HTTP 500
{
  "success": false,
  "error": "Internal server error",
  "code": "INTERNAL_ERROR"
}
```

---

## Throwing errors from application code

Import factory helpers from `@/lib/errors`:

```typescript
import { notFound, validationError, conflict, forbidden } from "@/lib/errors";

// Throw — withErrorHandler middleware catches it and serialises the envelope
throw notFound("Circle not found");

throw validationError("Invalid input", {
  fields: { amount: "Must be positive" },
});

throw conflict("Already a member of this circle");

throw forbidden("Only the circle admin can trigger payouts");
```

### Using the `AppError` class directly

```typescript
import { AppError } from "@/lib/errors";

throw new AppError("Custom message", "CUSTOM_CODE", 418, { hint: "teapot" });
```

### Checking at catch sites

```typescript
import { isAppError } from "@/lib/errors";

try {
  await someOperation();
} catch (err) {
  if (isAppError(err)) {
    // err.code, err.statusCode, err.details are all typed
    console.error(`[${err.code}] ${err.message}`);
  }
}
```

---

## Middleware integration

`withErrorHandler` (in `src/server/middleware/index.ts`) wraps every route handler and:

1. **Catches `AppError` instances** — serialises via `appErr.toJSON()` and returns the appropriate HTTP status. Known operational errors (4xx) are **not** forwarded to Sentry.
2. **Catches unknown errors** — wraps them as `INTERNAL_ERROR` (500), logs the original error, and forwards to Sentry for alerting.
3. **Always sets** `x-correlation-id` on the response.

```
Request → withErrorHandler
                │
         handler throws
                │
         ┌──────┴───────┐
         │ AppError?     │
         ├── yes ────────┤  return appErr.toJSON() at appErr.statusCode
         └── no  ────────┘  capture to Sentry, return INTERNAL_ERROR 500
```

---

## Persistence

Unhandled errors are optionally persisted to the `error_logs` table (migration `1790000000000_error-envelope-meta.ts`) for post-incident querying. The table stores `code`, `message`, `status_code`, `details`, `path`, `method`, `correlation_id`, `sentry_event_id`, and `stack_trace`.

---

## Client-side handling

TypeScript clients can discriminate on the `success` field:

```typescript
import type { ApiResponse } from "@/types";

const res = await fetch("/api/circles");
const body: ApiResponse<Circle[]> = await res.json();

if (!body.success) {
  switch (body.code) {
    case "NOT_FOUND":
      showToast("Circle not found");
      break;
    case "UNAUTHORIZED":
      router.push("/auth/login");
      break;
    case "VALIDATION_ERROR":
      setFieldErrors(body.details?.fields);
      break;
    default:
      showToast(body.error);
  }
}
```
