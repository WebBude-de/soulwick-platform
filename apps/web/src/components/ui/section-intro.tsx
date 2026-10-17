import type { ReactNode } from "react";

interface SectionIntroProps {
  /** Rendered next to the eyebrow, or alone above the title (e.g. a status chip). */
  aside?: ReactNode;
  className?: string;
  /** Small caps line above the title; only where it carries information. */
  eyebrow?: string;
  /** Icon in front of the eyebrow. */
  eyebrowIcon?: ReactNode;
  id: string;
  text?: string;
  title: string;
}

/** Optional eyebrow + H2 + lead paragraph, the opening of a landing section. */
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
      {eyebrow || aside ? (
        <p className="flex flex-wrap items-center gap-3">
          {eyebrowIcon}
          {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
          {aside}
        </p>
      ) : null}
      <h2 className="section-title" id={id}>
        {title}
      </h2>
      {text ? <p className="lead">{text}</p> : null}
    </div>
  );
}
