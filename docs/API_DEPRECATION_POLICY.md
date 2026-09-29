# API Deprecation Policy

1. **Announce** — add an entry to `DEPRECATIONS` in `src/lib/deprecation.ts` and to `CHANGELOG.md`.
2. **Notice period** — the sunset date must be at least **90 days** after the deprecation date (`validateDeprecation` enforces this).
3. **Signalling** — while deprecated, responses carry `Deprecation`, `Sunset` (RFC 8594) and, when a replacement exists, `Link: <…>; rel="successor-version"` headers.
4. **Removal** — after the sunset date the endpoint returns `410 Gone` with error code `GONE`.
5. **Observability** — every call to a deprecated or sunset endpoint is logged so owners can track remaining consumers before removal.
