import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type LinkHref = ComponentProps<typeof Link>["href"];

interface CommonProps {
  children: ReactNode;
  className?: string;
  size?: "default" | "sm";
  variant?: "default" | "primary";
}

interface ButtonAsLink extends CommonProps {
  external?: false;
  href: LinkHref;
  onClick?: never;
  type?: never;
}

interface ButtonAsExternal extends CommonProps {
  external: true;
  href: string;
  onClick?: never;
  type?: never;
}

interface ButtonAsButton extends CommonProps {
  disabled?: boolean;
  external?: never;
  href?: never;
  onClick?: () => void;
  type?: "button" | "submit";
}

export type PixelButtonProps = ButtonAsLink | ButtonAsExternal | ButtonAsButton;

/** Button in the handoff style: gold primary with ink rings, panel secondary. */
export function PixelButton(props: PixelButtonProps) {
  const classes = [
    "btn",
    props.variant === "primary" ? "btn-primary" : null,
    props.size === "sm" ? "btn-sm" : null,
    props.className,
  ]
    .filter(Boolean)
    .join(" ");

  if (props.href !== undefined && props.external) {
    return (
      <a className={classes} href={props.href} rel="noopener" target="_blank">
        {props.children}
      </a>
    );
  }
  if (props.href !== undefined) {
    return (
      <Link className={classes} href={props.href}>
        {props.children}
      </Link>
    );
  }
  return (
    <button
      aria-disabled={props.disabled ? "true" : undefined}
      className={classes}
      onClick={props.disabled ? undefined : props.onClick}
      type={props.type ?? "button"}
    >
      {props.children}
    </button>
  );
}
