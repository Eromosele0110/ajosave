/**
 * locale-format.ts — issue #12
 *
 * Locale-aware currency and date formatting utilities for Ajosave.
 *
 * The app supports four UI locales (en, yo, ig, ha) and four fiat currencies
 * (NGN, GBP, USD, EUR). This module maps each locale to a sensible BCP 47
 * language tag and provides helpers that produce correctly localised strings
 * using the browser/Node Intl API — no third-party library required.
 *
 * Edge cases handled:
 *   • Unknown locale falls back to "en-NG" (app default).
 *   • Amount is NaN / Infinity → returns the currency code as a safe fallback.
 *   • Date is an invalid Date object → returns "—".
 *   • Negative amounts are rendered with the locale's minus-sign convention.
 *   • Very large amounts (>= 1 billion) use compact notation to avoid overflow.
 */

import type { SupportedCurrency } from "./currency";
import type { Locale } from "../i18n";

/** BCP 47 tag for each app UI locale. */
const LOCALE_TAG: Record<Locale, string> = {
  en: "en-NG", // English as used in Nigeria
  yo: "yo-NG", // Yorùbá
  ig: "ig-NG", // Igbo
  ha: "ha-NG", // Hausa
};

/** ISO 4217 code → default regional locale for standalone currency formatting. */
const CURRENCY_DEFAULT_LOCALE: Record<SupportedCurrency, string> = {
  NGN: "en-NG",
  GBP: "en-GB",
  USD: "en-US",
  EUR: "de-DE",
};

/** Resolve a BCP 47 tag from an app locale, falling back gracefully. */
function resolveBCP47(locale?: Locale | string): string {
  if (!locale) return "en-NG";
  return LOCALE_TAG[locale as Locale] ?? "en-NG";
}

// ─── Currency formatting ──────────────────────────────────────────────────────

export interface FormatCurrencyOptions {
  /** App locale (en | yo | ig | ha). Falls back to "en" if omitted. */
  locale?: Locale | string;
  /**
   * Display style.
   * - "symbol"  (default) — "₦1,234.00"
   * - "code"              — "NGN 1,234.00"
   * - "name"              — "1,234.00 Nigerian nairas"
   */
  display?: "symbol" | "code" | "name";
  /** Compact notation for large numbers ("1.2B" instead of "1,200,000,000"). */
  compact?: boolean;
}

/**
 * Format a fiat amount in a locale-aware way.
 *
 * @example
 *   formatLocaleCurrency(1500, "NGN", { locale: "yo" })
 *   // → "₦1,500.00"  (Yorùbá locale with NGN symbol)
 *
 *   formatLocaleCurrency(1_234_567_890, "NGN", { compact: true })
 *   // → "₦1.23B"
 */
export function formatLocaleCurrency(
  amount: number,
  currency: SupportedCurrency,
  options: FormatCurrencyOptions = {}
): string {
  const { locale, display = "symbol", compact = false } = options;

  // Guard: non-finite amounts
  if (!Number.isFinite(amount)) return currency;

  const tag = resolveBCP47(locale) ?? CURRENCY_DEFAULT_LOCALE[currency];

  try {
    const formatter = new Intl.NumberFormat(tag, {
      style: "currency",
      currency,
      currencyDisplay: display,
      ...(compact && Math.abs(amount) >= 1_000_000_000
        ? { notation: "compact", maximumFractionDigits: 2 }
        : { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    });
    return formatter.format(amount);
  } catch {
    // Intl may not support the locale/currency combo in all environments
    return `${currency} ${amount.toFixed(2)}`;
  }
}

// ─── Date formatting ──────────────────────────────────────────────────────────

export type DateStyle = "short" | "medium" | "long" | "full";
export type TimeStyle = "short" | "medium" | "long" | "full";

export interface FormatDateOptions {
  /** App locale. Falls back to "en" if omitted. */
  locale?: Locale | string;
  dateStyle?: DateStyle;
  timeStyle?: TimeStyle;
  /** When true, omits the time portion entirely. Defaults to false. */
  dateOnly?: boolean;
}

/**
 * Format a date/timestamp in a locale-aware way.
 *
 * @example
 *   formatLocaleDate(new Date("2025-01-15T14:30:00Z"), { locale: "ha", dateOnly: true })
 *   // → "15/01/2025"  (Hausa locale, date only)
 *
 *   formatLocaleDate("2025-01-15T14:30:00Z", { locale: "en", timeStyle: "short" })
 *   // → "15 Jan 2025, 14:30"
 */
export function formatLocaleDate(
  value: Date | string | number,
  options: FormatDateOptions = {}
): string {
  const { locale, dateStyle = "medium", timeStyle = "short", dateOnly = false } = options;

  let date: Date;
  try {
    date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) return "—";
  } catch {
    return "—";
  }

  const tag = resolveBCP47(locale);

  try {
    const formatter = new Intl.DateTimeFormat(tag, {
      dateStyle,
      ...(dateOnly ? {} : { timeStyle }),
    });
    return formatter.format(date);
  } catch {
    return date.toISOString();
  }
}

// ─── Relative time formatting ─────────────────────────────────────────────────

/**
 * Format a date as a relative string ("2 days ago", "in 3 hours", etc.)
 * Falls back to an absolute date string for differences > 30 days.
 *
 * @example
 *   formatRelativeTime(Date.now() - 2 * 60 * 1000, { locale: "en" })
 *   // → "2 minutes ago"
 */
export function formatRelativeTime(
  value: Date | string | number,
  options: Pick<FormatDateOptions, "locale"> = {}
): string {
  const { locale } = options;
  let date: Date;
  try {
    date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) return "—";
  } catch {
    return "—";
  }

  const tag = resolveBCP47(locale);
  const diffMs = date.getTime() - Date.now();
  const diffSecs = Math.round(diffMs / 1000);
  const diffMins = Math.round(diffSecs / 60);
  const diffHours = Math.round(diffMins / 60);
  const diffDays = Math.round(diffHours / 24);

  // Fall back to absolute date for distant timestamps
  if (Math.abs(diffDays) > 30) {
    return formatLocaleDate(date, { locale, dateOnly: true });
  }

  try {
    const rtf = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
    if (Math.abs(diffSecs) < 60) return rtf.format(diffSecs, "second");
    if (Math.abs(diffMins) < 60) return rtf.format(diffMins, "minute");
    if (Math.abs(diffHours) < 24) return rtf.format(diffHours, "hour");
    return rtf.format(diffDays, "day");
  } catch {
    return formatLocaleDate(date, { locale, dateOnly: true });
  }
}

// ─── Convenience re-exports ───────────────────────────────────────────────────

export { LOCALE_TAG, CURRENCY_DEFAULT_LOCALE };
