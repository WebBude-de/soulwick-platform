import { useTranslations } from "next-intl";
import { PixelIcon } from "@/components/ui/pixel-icon";
import type { SocialLink } from "@/lib/social";

interface SocialLinksProps {
  className?: string;
  /** Only channels with a URL (`socialLinks()`); an empty list renders nothing. */
  links: SocialLink[];
  /** `list`: footer column; `row`: chips on the landing page. */
  variant: "list" | "row";
}

const listLinkClass =
  "inline-flex min-h-9 items-center gap-2 text-[15px] text-text transition-colors hover:text-gold";

/** Soulwick's social channels from `content/social.json`, each with a small pixel icon. */
export function SocialLinks({ links, variant, className }: SocialLinksProps) {
  const tc = useTranslations("common");
  if (links.length === 0) {
    return null;
  }
  const listClass = variant === "row" ? "social-row" : "flex flex-col";

  return (
    <ul className={[listClass, className].filter(Boolean).join(" ")}>
      {links.map((link) => (
        <li key={link.id}>
          <a
            className={variant === "row" ? "chip social-chip" : listLinkClass}
            href={link.url}
            rel="noopener me"
            target="_blank"
          >
            <PixelIcon name={link.id} />
            <span>{link.label}</span>
            <span className="sr-only"> {tc("footer.newTab")}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
