import Image from "next/image";
import { useTranslations } from "next-intl";
import { SectionIntro } from "@/components/ui/section-intro";
import type { BrandImage } from "@/lib/brand";

interface VillageProps {
  /** The village from the game (`brand.village()`): today's screenshot by day. */
  scene: BrandImage | null;
}

/**
 * "Your village" (D-174): the one daylight section of the page, sweet and cozy. Shows the
 * village exactly as it looks in the game (a screenshot from a quiet game run, see
 * `scripts/sync-village.ts`), with the forge fire glowing on top. Build it up, make it yours,
 * invite your friends: all part of the game at release.
 */
export function Village({ scene }: VillageProps) {
  const t = useTranslations("landing");
  const items = t.raw("village.items") as [string, string][];
  const isScreenshot = scene?.width === 1280;

  return (
    <section aria-labelledby="village-title" className="village" id="dorf">
      <div aria-hidden="true" className="village-clouds">
        <span className="cloud cloud-a" />
        <span className="cloud cloud-b" />
        <span className="cloud cloud-c" />
      </div>
      <div className="container-site village-grid">
        <div className="flex flex-col gap-8">
          <SectionIntro
            id="village-title"
            text={t("village.lead")}
            title={t("village.title")}
          />
          <ul className="village-items">
            {items.map(([name, text]) => (
              <li key={name}>
                <strong className="village-item-title">{name}</strong>
                <p>{text}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className="village-frame">
          <div className="village-scene">
            {scene ? (
              <Image
                alt={t("village.sceneAlt")}
                className={isScreenshot ? "village-shot" : undefined}
                height={scene.height}
                sizes="(min-width: 64rem) 560px, 100vw"
                src={scene.src}
                unoptimized
                width={scene.width}
              />
            ) : (
              <div className="h-full w-full bg-grass" />
            )}
            {isScreenshot ? (
              <span aria-hidden="true" className="village-forge-glow" />
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
