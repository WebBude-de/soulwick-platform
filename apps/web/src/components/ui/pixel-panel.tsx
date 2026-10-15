import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

type PanelVariant = "default" | "gold" | "dark";

const variantClass: Record<PanelVariant, string> = {
  default: "pixel-panel",
  gold: "pixel-panel-gold",
  dark: "pixel-panel-dark",
};

type PixelPanelProps<T extends ElementType> = {
  as?: T;
  variant?: PanelVariant;
  className?: string;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "className" | "children">;

/**
 * Card in the handoff style (panel surface, 2 px line, hard 4 px shadow). `gold` = gold
 * border (selected), `dark` = deep surface.
 */
export function PixelPanel<T extends ElementType = "div">({
  as,
  variant = "default",
  className,
  children,
  ...rest
}: PixelPanelProps<T>) {
  const Tag = (as ?? "div") as ElementType;
  return (
    <Tag
      className={[variantClass[variant], className].filter(Boolean).join(" ")}
      {...rest}
    >
      {children}
    </Tag>
  );
}
