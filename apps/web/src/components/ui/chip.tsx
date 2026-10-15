import type { ReactElement, ReactNode } from "react";
import { Sprite } from "@/components/ui/sprite";
import type { SpriteId } from "@/lib/sprite-manifest";

interface ChipProps {
  caps?: boolean;
  children: ReactNode;
  className?: string;
  /** Renders as link when set. */
  href?: string;
  /** 16 px icon on the left: a sprite id or a ready node (e.g. `PixelIcon`). */
  icon?: SpriteId | ReactElement;
  /** Status part on the right (e.g. „geplant“ with `chip_planned`). */
  status?: { label: string; icon?: SpriteId };
}

/** Pixel chip: deep surface, 2 px line, Pixelify 14 px. */
export function Chip({
  children,
  icon,
  status,
  href,
  caps,
  className,
}: ChipProps) {
  const classes = ["chip", caps ? "chip-caps" : null, className]
    .filter(Boolean)
    .join(" ");
  const content = (
    <>
      {typeof icon === "string" ? (
        <Sprite id={icon} scale={1} />
      ) : (
        (icon ?? null)
      )}
      <span>{children}</span>
      {status ? (
        <span className="chip-status">
          {status.icon ? <Sprite id={status.icon} scale={1} /> : null}
          <span>{status.label}</span>
        </span>
      ) : null}
    </>
  );
  if (href) {
    return (
      <a className={classes} href={href} rel="noopener" target="_blank">
        {content}
      </a>
    );
  }
  return <span className={classes}>{content}</span>;
}
