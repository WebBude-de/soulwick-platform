import type { ReactNode } from "react";

interface SectionIntroProps {
  /** Rendered next to the eyebrow (e.g. a „geplant“ chip). */
  aside?: ReactNode;
  className?: string;
  eyebrow: string;
  /** Icon in front of the eyebrow (hero soul flame). */
  eyebrowIcon?: ReactNode;
  id: string;
  text?: string;
  title: string;
}

/** Eyebrow + H2 + lead paragraph, the opening of every landing section. */
export function SectionIntro({
  id,
  eyebrow,
  title,
  text,
  aside,
  eyebrowIcon,
  className,
}: SectionIntroProps) {
  return (
    <div
      className={["flex max-w-3xl flex-col gap-4", className]
        .filter(Boolean)
        .join(" ")}
    >
      <p className="flex flex-wrap items-center gap-3">
        {eyebrowIcon}
        <span className="eyebrow">{eyebrow}</span>
        {aside}
      </p>
      <h2 className="text-text" id={id}>
        {title}
      </h2>
      {text ? <p className="lead">{text}</p> : null}
    </div>
  );
}
