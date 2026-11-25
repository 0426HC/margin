import { useId, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";

type FieldProps = { label: string; hint?: string; error?: string; hideLabel?: boolean };

/** A labelled text field. The label is always there for screen readers; `hideLabel` only hides it visually. */
export function Input({ label, hint, error, hideLabel, className = "", ...rest }: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const note = error ?? hint;
  return (
    <div>
      <label htmlFor={id} className={hideLabel ? "sr-only" : "m-field-label"}>
        {label}
      </label>
      <input id={id} className={`m-input ${className}`} aria-invalid={error ? true : undefined} aria-describedby={note ? `${id}-note` : undefined} {...rest} />
      {note && (
        <p id={`${id}-note`} className={error ? "m-field-error" : "m-field-hint"}>
          {note}
        </p>
      )}
    </div>
  );
}

export function Textarea({ label, hint, error, hideLabel, className = "", rows = 2, ...rest }: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  const note = error ?? hint;
  return (
    <div>
      <label htmlFor={id} className={hideLabel ? "sr-only" : "m-field-label"}>
        {label}
      </label>
      <textarea id={id} rows={rows} className={`m-input ${className}`} aria-invalid={error ? true : undefined} aria-describedby={note ? `${id}-note` : undefined} {...rest} />
      {note && (
        <p id={`${id}-note`} className={error ? "m-field-error" : "m-field-hint"}>
          {note}
        </p>
      )}
    </div>
  );
}
