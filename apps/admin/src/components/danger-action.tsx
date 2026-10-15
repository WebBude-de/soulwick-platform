import type { ReactNode } from "react";

/** Optional reason field; required whenever the API stores a reason (ban, flag). */
export interface ReasonField {
  label: string;
  maxLength?: number;
  minLength?: number;
  /** Form field name read by the server action. */
  name?: string;
  placeholder?: string;
  required?: boolean;
}

/**
 * The one confirmation pattern for destructive moderation steps (ban, disband, remove member,
 * delete run or account, disable admin). Without client JS: a <details> disclosure opens the form;
 * the server action checks the confirmation again (`confirm` checkbox or typed `confirmText`).
 */
export function DangerAction({
  action,
  trigger,
  submitLabel,
  description,
  reason,
  confirmText,
  confirmLabel = "Ja, ich bin sicher.",
  small = false,
  neutral = false,
  children,
}: {
  action: (form: FormData) => Promise<void>;
  /** Label of the disclosure button, ends with "…". */
  trigger?: string;
  submitLabel: string;
  description?: ReactNode;
  reason?: ReasonField;
  /** Text the admin has to type (guild tag, player name); otherwise a checkbox. */
  confirmText?: string;
  confirmLabel?: string;
  small?: boolean;
  /**
   * Not destructive, only needs a reason (e.g. flag a run): neutral frame and button, no
   * confirmation checkbox.
   */
  neutral?: boolean;
  /** Extra fields (selects, hidden inputs) shown above the reason. */
  children?: ReactNode;
}) {
  const form = (
    <form
      action={action}
      className={`confirm-box ${neutral ? "confirm-box-neutral" : ""}`}
    >
      {description ? (
        <div className="space-y-1 text-soft">{description}</div>
      ) : null}
      {children}
      {reason ? (
        <label className="block">
          <span className="field-label">
            {reason.label}
            {reason.required === false ? " (optional)" : " (Pflicht)"}
          </span>
          <input
            className="input w-full"
            maxLength={reason.maxLength ?? 500}
            minLength={
              reason.required === false ? undefined : (reason.minLength ?? 3)
            }
            name={reason.name ?? "reason"}
            placeholder={reason.placeholder}
            required={reason.required !== false}
          />
        </label>
      ) : null}
      {neutral ? null : confirmText ? (
        <label className="block">
          <span className="field-label">
            Zur Bestätigung eintippen:{" "}
            <strong className="font-data text-text">{confirmText}</strong>
          </span>
          <input
            autoComplete="off"
            className="input w-full"
            name="confirmText"
            required
          />
        </label>
      ) : (
        <label className="flex items-center gap-2 text-soft">
          <input name="confirm" required type="checkbox" />
          {confirmLabel}
        </label>
      )}
      <div>
        <button className={`btn ${neutral ? "" : "btn-danger"}`} type="submit">
          {submitLabel}
        </button>
      </div>
    </form>
  );

  return (
    <details className={small ? "w-full min-w-56 max-w-80" : "max-w-xl"}>
      <summary
        className={`btn ${neutral ? "" : "btn-danger"} ${small ? "btn-sm" : ""}`}
      >
        {trigger ?? submitLabel}
      </summary>
      {form}
    </details>
  );
}
