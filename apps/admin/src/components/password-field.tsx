"use client";

import { type ReactNode, useId, useState, useSyncExternalStore } from "react";
import { ActionIcon } from "./action-icon";

const noSubscribe = () => () => undefined;

/** True only after hydration; false on the server and without client JavaScript. */
function useHydrated(): boolean {
  return useSyncExternalStore<boolean>(
    noSubscribe,
    () => true,
    () => false
  );
}

/**
 * Labelled password input with a "show / hide password" toggle. The toggle only switches the
 * input `type` between `password` and `text`; the value never leaves the form. Without client
 * JavaScript the toggle is not rendered and the field works as a plain password input.
 */
export function PasswordField({
  label,
  name,
  autoComplete,
  className = "",
  inputClassName = "w-full",
  minLength,
  maxLength,
  required = false,
}: {
  label: ReactNode;
  name: string;
  autoComplete: "current-password" | "new-password";
  /** Wrapper classes (layout, width in flex rows). */
  className?: string;
  /** Width classes for the input. */
  inputClassName?: string;
  minLength?: number;
  maxLength?: number;
  required?: boolean;
}) {
  const id = useId();
  const hydrated = useHydrated();
  const [visible, setVisible] = useState(false);

  return (
    <div className={className}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          autoCapitalize="off"
          autoComplete={autoComplete}
          autoCorrect="off"
          className={`input ${inputClassName} ${hydrated ? "pr-11" : ""}`}
          id={id}
          maxLength={maxLength}
          minLength={minLength}
          name={name}
          required={required}
          spellCheck={false}
          type={visible ? "text" : "password"}
        />
        {hydrated ? (
          <button
            aria-controls={id}
            aria-label="Passwort anzeigen"
            aria-pressed={visible}
            className="absolute inset-y-1 right-1 flex w-8 items-center justify-center rounded-[2px] text-muted hover:text-text"
            onClick={() => setVisible((v) => !v)}
            title={visible ? "Passwort verbergen" : "Passwort anzeigen"}
            type="button"
          >
            <ActionIcon name={visible ? "eyeOff" : "eye"} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
