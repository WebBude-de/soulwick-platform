import type { ReactNode } from "react";
import { ActionIcon, type ActionIconName } from "./action-icon";

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

interface ConfirmFormProps {
  action: (form: FormData) => Promise<void>;
  /** Extra fields (selects, hidden inputs) shown above the reason. */
  children?: ReactNode;
  confirmLabel?: string;
  /** Text the admin has to type (guild tag, player name); otherwise a checkbox. */
  confirmText?: string;
  description?: ReactNode;
  /**
   * Not destructive, only needs a reason (e.g. flag a run): neutral frame and button, no
   * confirmation checkbox.
   */
  neutral?: boolean;
  reason?: ReasonField;
  submitLabel: string;
}

/** The form inside both variants; the server action checks the confirmation again. */
function ConfirmForm({
  action,
  submitLabel,
  description,
  reason,
  confirmText,
  confirmLabel = "Ja, ich bin sicher.",
  neutral = false,
  children,
  className = "",
  cancel,
}: ConfirmFormProps & { className?: string; cancel?: ReactNode }) {
  return (
    <form
      action={action}
      className={`confirm-box ${neutral ? "confirm-box-neutral" : ""} ${className}`}
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
      <div className="flex flex-wrap gap-3">
        <button className={`btn ${neutral ? "" : "btn-danger"}`} type="submit">
          {submitLabel}
        </button>
        {cancel}
      </div>
    </form>
  );
}

/**
 * The one confirmation pattern for destructive moderation steps on detail pages (ban, disband,
 * delete an account). Without client JS: a <details> disclosure opens the form below the button.
 * In table rows use `RowDangerAction`.
 */
export function DangerAction({
  trigger,
  ...form
}: ConfirmFormProps & {
  /** Label of the disclosure button, ends with "…". */
  trigger?: string;
}) {
  return (
    <details className="max-w-xl">
      <summary className={`btn ${form.neutral ? "" : "btn-danger"}`}>
        {trigger ?? form.submitLabel}
      </summary>
      <ConfirmForm {...form} />
    </details>
  );
}

/**
 * Row action with confirmation (delete a run, remove a member, kick from a room …): a compact
 * button that opens the form in a native popover (`popovertarget`, no client JS), so the actions
 * of a row sit side by side and the row keeps its height. `id` must be unique on the page.
 */
export function RowDangerAction({
  id,
  label,
  title,
  icon,
  iconOnly = false,
  hint,
  ...form
}: ConfirmFormProps & {
  /** Unique on the page (e.g. `run-delete-<uuid>`). */
  id: string;
  /** Button text; for icon-only buttons the aria-label and tooltip. */
  label: string;
  /** Heading of the popover, e.g. "Run vom 13.10.2026 löschen". Defaults to submitLabel. */
  title?: ReactNode;
  icon?: ActionIconName;
  iconOnly?: boolean;
  /** Tooltip when the label alone is too short (defaults to the label). */
  hint?: string;
}) {
  const popoverId = `confirm-${id}`;
  const tone = form.neutral ? "" : "btn-danger";
  return (
    <>
      <button
        aria-label={iconOnly ? label : undefined}
        className={`btn btn-sm ${tone} ${iconOnly ? "btn-icon" : ""}`}
        popoverTarget={popoverId}
        title={hint ?? label}
        type="button"
      >
        {icon ? <ActionIcon name={icon} /> : null}
        {iconOnly ? null : <span>{label}</span>}
      </button>
      <div
        className={`confirm-popover ${form.neutral ? "confirm-popover-neutral" : ""}`}
        id={popoverId}
        popover="auto"
      >
        <p className="border-line border-b-2 px-3 py-2.5 font-bold text-base text-text">
          {title ?? form.submitLabel}
        </p>
        <ConfirmForm
          {...form}
          cancel={
            <button
              className="btn"
              popoverTarget={popoverId}
              popoverTargetAction="hide"
              type="button"
            >
              Abbrechen
            </button>
          }
        />
      </div>
    </>
  );
}

/** Plain row action without confirmation (release a run, enable an admin). */
export function RowAction({
  action,
  label,
  icon,
  hint,
}: {
  action: (form: FormData) => Promise<void>;
  label: string;
  icon?: ActionIconName;
  /** Tooltip with more context. */
  hint?: string;
}) {
  return (
    <form action={action}>
      <button className="btn btn-sm" title={hint ?? label} type="submit">
        {icon ? <ActionIcon name={icon} /> : null}
        {label}
      </button>
    </form>
  );
}
