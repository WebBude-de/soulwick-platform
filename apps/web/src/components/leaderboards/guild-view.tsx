import { MAX_GUILD_MEMBERS, type PublicGuild } from "@soulwick/contracts";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { PixelButton } from "@/components/ui/pixel-button";
import { PixelPanel } from "@/components/ui/pixel-panel";
import { Sprite } from "@/components/ui/sprite";
import { type ApiResult, formatDuration } from "@/lib/api";

export function GuildView({ result }: { result: ApiResult<PublicGuild> }) {
  const t = useTranslations("guilds");
  const format = useFormatter();

  if (!result.ok) {
    return (
      <PixelPanel
        className="flex flex-col items-center gap-3 p-8 text-center"
        variant="dark"
      >
        <Sprite id="icon_lock" scale={3} />
        <p className="font-pixel text-gold text-xl">{t("unreachable.title")}</p>
        <p className="max-w-md text-soft">{t("unreachable.text")}</p>
      </PixelPanel>
    );
  }

  const guild = result.data;
  const date = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "long" });

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col items-start gap-3">
        <span className="pixel-nameplate text-gold text-lg">[{guild.tag}]</span>
        <h1 className="candle-glow text-3xl text-gold sm:text-5xl">
          {guild.name}
        </h1>
        <p className="text-soft">
          {t("founded", { date: date(guild.createdAt) })}
        </p>
      </header>

      <dl className="grid gap-4 sm:grid-cols-3">
        <Stat
          icon={<Sprite id="icon_host" scale={2} />}
          label={t("stats.members")}
          value={`${guild.memberCount} / ${MAX_GUILD_MEMBERS}`}
        />
        <Stat
          icon={<Sprite id="skull_icon" scale={2} />}
          label={t("stats.bestRoom")}
          value={guild.bestRun ? String(guild.bestRun.roomReached) : "–"}
        />
        <Stat
          icon={<Sprite id="clock_icon" scale={2} />}
          label={t("stats.time")}
          value={
            guild.bestRun ? formatDuration(guild.bestRun.durationSeconds) : "–"
          }
        />
      </dl>

      <p className="text-soft">
        {guild.bestRun
          ? t("bestRun", { date: date(guild.bestRun.achievedAt) })
          : t("noRun")}
      </p>

      <div>
        <PixelButton
          href={{ pathname: "/leaderboards", query: { art: "gilden" } }}
        >
          <Sprite id="icon_leaderboard" scale={2} />
          {t("toBoard")}
        </PixelButton>
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <PixelPanel className="flex flex-col items-center gap-2 p-5 text-center">
      <dt className="flex items-center gap-2 font-pixel text-muted text-sm">
        {icon}
        {label}
      </dt>
      <dd className="font-pixel text-3xl text-gold">{value}</dd>
    </PixelPanel>
  );
}
