import type { ReactNode } from "react";
import { PixelPanel } from "@/components/ui/pixel-panel";
import { Sprite } from "@/components/ui/sprite";
import type { SpriteId } from "@/lib/sprite-manifest";

/**
 * Building blocks of the login pages (KF11): one narrow column under a single warm light (the
 * soul lantern), so the few decisions on these pages stay in focus on a phone as on a desktop.
 * Usable from Server and Client Components.
 */
export function LoginShell({
  eyebrow,
  title,
  sprite = "soul_lantern_4f",
  children,
}: {
  eyebrow: string;
  title: string;
  sprite?: SpriteId;
  children: ReactNode;
}) {
  return (
    <div className="relative isolate overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[38rem] bg-[radial-gradient(ellipse_42rem_26rem_at_50%_4rem,rgb(255_181_74/0.17),rgb(255_181_74/0.05)_45%,transparent_72%)]"
      />
      <div className="container-site flex justify-center pt-10 pb-16 sm:pt-14 sm:pb-24">
        <div className="flex w-full max-w-[34rem] flex-col gap-7">
          <header className="flex flex-col items-center gap-3 text-center">
            <Sprite
              className="drop-shadow-[0_0_18px_rgb(255_181_74/0.55)]"
              id={sprite}
              scale={3}
            />
            <p className="eyebrow">{eyebrow}</p>
            <h1 className="text-balance text-3xl sm:text-[2.5rem]">{title}</h1>
          </header>
          {children}
        </div>
      </div>
    </div>
  );
}

/** The main card of a step. */
export function LoginPanel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <PixelPanel
      className={["flex flex-col gap-6 p-5 sm:p-7", className]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </PixelPanel>
  );
}

/**
 * "Only go on if you started this yourself": the safety question of every step, in warm candle
 * light so it reads as important without looking like an error.
 */
export function Warning({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-[3px] border-2 border-candle-deep bg-[rgb(224_122_46/0.1)] px-4 py-3">
      <Sprite className="mt-0.5 shrink-0" id="icon_lock" scale={2} />
      <div className="flex flex-col gap-1">
        <p className="font-pixel text-candle-light text-lg leading-snug">
          {title}
        </p>
        <p className="text-sm text-soft">{children}</p>
      </div>
    </div>
  );
}

/** Short message above a form or step (`danger` for errors, `calm` for confirmations). */
export function Notice({
  title,
  tone = "danger",
  children,
  live = false,
}: {
  title?: string;
  tone?: "danger" | "calm";
  children: ReactNode;
  /** Announce the message when it appears (results of a form). */
  live?: boolean;
}) {
  return (
    <div
      className={`flex items-start gap-3 rounded-[3px] border-2 bg-bg-deep px-4 py-3 ${tone === "danger" ? "border-danger" : "border-[#2f944c]"}`}
      role={live ? (tone === "danger" ? "alert" : "status") : undefined}
    >
      <Sprite
        className="mt-0.5 shrink-0"
        id={tone === "danger" ? "icon_info" : "chip_done"}
        scale={2}
      />
      <div className="flex flex-col gap-1">
        {title ? (
          <p className="font-pixel text-lg text-text leading-snug">{title}</p>
        ) : null}
        <div className="text-sm text-soft">{children}</div>
      </div>
    </div>
  );
}

/** Player name with its level, as a small plaque. */
export function AccountPlaque({
  name,
  levelLabel,
}: {
  name: string;
  levelLabel: string | null;
}) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2">
      <span className="break-all font-pixel text-gold">{name}</span>
      {levelLabel ? (
        <span className="font-pixel text-muted text-sm">{levelLabel}</span>
      ) : null}
    </span>
  );
}
