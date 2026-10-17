import { Chicken } from "@/components/fun/chicken";
import { Sprite } from "@/components/ui/sprite";
import { WickButton } from "@/components/wick/wick-button";
import type { WickArt } from "@/lib/brand";

/**
 * Little scene next to the news title: Wick and the chicken by a torch. Shows the delivered
 * `wick/wick_chicken.webp` when it exists, else the placeholder Wick and the game's chicken.
 */
export function NewsScene({ art }: { art: WickArt }) {
  return (
    <div className="news-scene">
      <span aria-hidden="true" className="news-scene-torch">
        <Sprite id="torch_stand_4f" scale={3} />
      </span>
      {art.withChicken ? (
        // biome-ignore lint/performance/noImgElement: delivered pixel illustration, shown 1:1 without optimisation.
        <img
          alt=""
          className="news-scene-art"
          height={360}
          src={art.withChicken}
          width={640}
        />
      ) : (
        <>
          <span className="news-scene-wick wick-glow">
            <WickButton scale={4} src={art.idle} />
          </span>
          <Chicken idle scale={3} />
        </>
      )}
    </div>
  );
}
