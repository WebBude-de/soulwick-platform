import type { ReactNode } from "react";

interface SectionHeadingProps {
  align?: "left" | "center";
  className?: string;
  /** Small eyebrow above the title (Pixelify caps, violet). */
  eyebrow?: string;
  /** Small sprite shown left of the heading. */
  icon?: ReactNode;
  id: string;
  /** One or two sentences under the heading. */
  intro?: string;
  title: string;
}

/** Section title in the pixel face with optional eyebrow, sprite and intro line. */
export function SectionHeading({
  id,
  title,
  intro,
  eyebrow,
  icon,
  align = "left",
  className,
}: SectionHeadingProps) {
  return (
    <div
      className={[
        "flex max-w-3xl flex-col gap-3",
        align === "center" ? "mx-auto items-center text-center" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h2 className="flex items-center gap-3 text-text" id={id}>
        {icon}
        <span>{title}</span>
      </h2>
      {intro ? <p className="lead">{intro}</p> : null}
    </div>
  );
}
