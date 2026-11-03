"use client";

import { useFormStatus } from "react-dom";

/** Submit button that shows a busy label while its form's Server Action runs. */
export function SubmitButton({
  label,
  busyLabel,
  className = "btn btn-primary w-full",
}: {
  label: string;
  busyLabel: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  const text = pending ? busyLabel : label;
  return (
    <button
      aria-disabled={pending}
      className={`${className} disabled:cursor-wait`}
      disabled={pending}
      type="submit"
    >
      {text}
    </button>
  );
}
