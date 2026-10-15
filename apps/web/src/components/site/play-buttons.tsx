import { useTranslations } from "next-intl";
import { PixelIcon } from "@/components/ui/pixel-icon";
import type { GameLinks } from "@/lib/game";

interface PlayButtonsProps {
  className?: string;
  links: GameLinks;
  size?: "default" | "sm";
}

/**
 * "Play in your browser" (gold) and "Install the web app" (panel). The browser version lives on
 * its own domain, so these are plain links in the same tab: no embedding, no new window.
 */
export function PlayButtons({
  links,
  size = "default",
  className,
}: PlayButtonsProps) {
  const t = useTranslations("common.play");
  const sizeClass = size === "sm" ? " btn-sm" : "";

  return (
    <div className={["play-buttons", className].filter(Boolean).join(" ")}>
      <a className={`btn btn-primary${sizeClass}`} href={links.play}>
        <PixelIcon name="play" />
        {t("cta")}
      </a>
      <a className={`btn${sizeClass}`} href={links.install}>
        <PixelIcon name="install" />
        {t("install")}
      </a>
    </div>
  );
}
