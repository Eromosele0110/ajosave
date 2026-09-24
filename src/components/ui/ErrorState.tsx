import styles from "./ErrorState.module.css";

interface ErrorStateProps {
  title?: string;
  message?: string;
  /** Called when the user clicks "Try again" */
  onRetry?: () => void;
  /** If true, show a "Go to home" link instead of only a retry button */
  showHomeLink?: boolean;
}

/**
 * Reusable error display for both error boundaries and inline async errors.
 * Provides a consistent layout with an illustration, heading, description,
 * and optional retry / home actions.
 */
export function ErrorState({
  title = "Something went wrong",
  message = "An unexpected error occurred. Please try again.",
  onRetry,
  showHomeLink = false,
}: ErrorStateProps) {
  return (
    <div className={styles.container} role="alert" aria-live="assertive">
      <div className={styles.inner}>
        <div className={styles.illustration} aria-hidden="true">
          <svg
            width="80"
            height="80"
            viewBox="0 0 80 80"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle
              cx="40"
              cy="40"
              r="36"
              stroke="var(--color-error)"
              strokeWidth="2"
              strokeOpacity="0.4"
            />
            <circle
              cx="40"
              cy="40"
              r="28"
              fill="var(--color-error)"
              fillOpacity="0.07"
            />
            <line
              x1="40"
              y1="24"
              x2="40"
              y2="44"
              stroke="var(--color-error)"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <circle cx="40" cy="52" r="2.5" fill="var(--color-error)" />
          </svg>
        </div>

        <h2 className={styles.title}>{title}</h2>
        <p className={styles.message}>{message}</p>

        <div className={styles.actions}>
          {onRetry && (
            <button className="btn btn--primary" onClick={onRetry}>
              Try again
            </button>
          )}
          {showHomeLink && (
            <a href="/" className="btn btn--ghost">
              Go to home
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
