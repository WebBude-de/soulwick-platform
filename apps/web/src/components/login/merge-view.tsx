import type { AccountSummary, WebLoginMerge } from "@soulwick/contracts";
import { useTranslations } from "next-intl";
import { Sprite } from "@/components/ui/sprite";

/**
 * "Two accounts become one" (D-122, D-188): both accounts side by side, the older one stays and
 * keeps its name, the other merges in. Shown inside the confirmation step before the player
 * types the code from the game.
 */
export function MergeView({ merge }: { merge: WebLoginMerge }) {
  const t = useTranslations("login.merge");
  const what = ["name", "progress", "worlds", "guilds"] as const;
  return (
    <section aria-labelledby="merge-title" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-gold text-xl sm:text-2xl" id="merge-title">
          {t("title")}
        </h2>
        <p className="text-sm text-soft">{t("lead")}</p>
      </div>
      <div className="grid items-stretch gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <AccountCard account={merge.removed} side="goes" />
        <div
          aria-hidden="true"
          className="flex items-center justify-center font-pixel text-2xl text-candle sm:px-1"
        >
          <span className="rotate-90 sm:rotate-0">→</span>
        </div>
        <AccountCard account={merge.remaining} side="stays" />
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-base text-text">{t("whatTitle")}</h3>
        <ul className="flex flex-col gap-1.5 text-sm text-soft">
          {what.map((key) => (
            <li className="flex items-start gap-2" key={key}>
              <span aria-hidden="true" className="font-pixel text-candle">
                ›
              </span>
              <span>{t(`what.${key}`)}</span>
            </li>
          ))}
          <li className="flex items-start gap-2 font-bold text-text">
            <span aria-hidden="true" className="font-pixel text-danger">
              !
            </span>
            <span>{t("what.final")}</span>
          </li>
        </ul>
      </div>
    </section>
  );
}

function AccountCard({
  account,
  side,
}: {
  account: AccountSummary;
  side: "stays" | "goes";
}) {
  const t = useTranslations("login");
  const guilds = account.guilds ?? (account.guild ? [account.guild] : []);
  const stays = side === "stays";
  return (
    <div
      className={`flex flex-col gap-2.5 rounded-[3px] border-2 bg-bg-deep p-4 ${stays ? "border-gold-dark" : "border-line-light border-dashed"}`}
    >
      <p
        className={`font-pixel text-xs uppercase tracking-[0.08em] ${stays ? "text-gold" : "text-muted"}`}
      >
        {t(`merge.${side}`)}
      </p>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="break-all font-pixel text-text text-xl">
          {account.name}
        </span>
        {account.level === undefined ? null : (
          <span className="font-pixel text-muted text-sm">
            {t("level", { level: account.level })}
          </span>
        )}
      </p>
      <ul className="flex flex-col gap-1 text-sm text-soft">
        <li className="flex items-center gap-2">
          <Sprite id="trophy_icon" scale={1} />
          {t("merge.runs", { count: account.runCount })}
        </li>
        {account.worlds === undefined ? null : (
          <li className="flex items-center gap-2">
            <Sprite id="icon_world" scale={1} />
            {t("merge.worlds", { count: account.worlds })}
          </li>
        )}
        <li className="flex items-start gap-2">
          <Sprite className="mt-0.5" id="shield_icon" scale={1} />
          <span className="break-words">
            {guilds.length > 0
              ? guilds.map((g) => `${g.name} [${g.tag}]`).join(", ")
              : t("merge.noGuild")}
          </span>
        </li>
        {account.providers.length > 0 ? (
          <li className="flex items-start gap-2">
            <Sprite className="mt-0.5" id="icon_lock" scale={1} />
            <span>
              {account.providers.map((p) => providerLabel(t, p)).join(" · ")}
            </span>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

const KNOWN_PROVIDERS = new Set([
  "steam",
  "device",
  "google_play",
  "game_center",
  "password",
  "email",
  "google",
  "apple",
  "discord",
]);

/** Display name of a login provider; unknown values (newer API) show as they are. */
export function providerLabel(
  t: ReturnType<typeof useTranslations<"login">>,
  provider: string
): string {
  return KNOWN_PROVIDERS.has(provider)
    ? t(`accountProviders.${provider}` as "accountProviders.steam")
    : provider;
}
