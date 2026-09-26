import { clsx } from "clsx";
import { forwardRef, useId } from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  /** Override the auto-generated hint/error element ID */
  descriptionId?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, id, className, descriptionId, ...props }, ref) => {
    // Auto-generate a stable base id from the label if none is provided
    const generatedId = useId();
    const inputId = id ?? (label ? label.toLowerCase().replace(/\s+/g, "-") : generatedId);

    // The id used for the hint/error element so we can link it via aria-describedby
    const helpTextId = descriptionId ?? `${inputId}-help`;

    const hasHelpText = !!(hint || error);

    return (
      <div className="input-group">
        {label && (
          <label className="input-label" htmlFor={inputId}>
            {label}
            {props.required && (
              <span aria-hidden="true" style={{ color: "var(--color-error)", marginLeft: "0.25em" }}>
                *
              </span>
            )}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={clsx("input", error && "input--error", className)}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={hasHelpText ? helpTextId : undefined}
          aria-required={props.required}
          {...props}
        />
        {hint && !error && (
          <span id={helpTextId} className="input-error-msg" style={{ color: "var(--color-text-muted)" }}>
            {hint}
          </span>
        )}
        {error && (
          <span id={helpTextId} className="input-error-msg" role="alert" aria-live="polite">
            {error}
          </span>
        )}
      </div>
    );
  }
);
Input.displayName = "Input";
