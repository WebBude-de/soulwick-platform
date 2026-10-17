import deCommon from "../../messages/de/common.json";
import deDeletion from "../../messages/de/deletion.json";
import deGuilds from "../../messages/de/guilds.json";
import deLanding from "../../messages/de/landing.json";
import deLeaderboards from "../../messages/de/leaderboards.json";
import deLegal from "../../messages/de/legal.json";
import deNews from "../../messages/de/news.json";
import deOpenSource from "../../messages/de/opensource.json";
import enCommon from "../../messages/en/common.json";
import enDeletion from "../../messages/en/deletion.json";
import enGuilds from "../../messages/en/guilds.json";
import enLanding from "../../messages/en/landing.json";
import enLeaderboards from "../../messages/en/leaderboards.json";
import enLegal from "../../messages/en/legal.json";
import enNews from "../../messages/en/news.json";
import enOpenSource from "../../messages/en/opensource.json";
import type { Locale } from "./locale";

/**
 * One namespace per message file: `messages/<locale>/<namespace>.json`
 * (common, landing, legal, leaderboards, guilds, deletion, opensource, news).
 * Components address keys as `useTranslations("landing")` → `t("hero.title")`.
 */
const de = {
  common: deCommon,
  landing: deLanding,
  legal: deLegal,
  leaderboards: deLeaderboards,
  guilds: deGuilds,
  deletion: deDeletion,
  opensource: deOpenSource,
  news: deNews,
};

const en = {
  common: enCommon,
  landing: enLanding,
  legal: enLegal,
  leaderboards: enLeaderboards,
  guilds: enGuilds,
  deletion: enDeletion,
  opensource: enOpenSource,
  news: enNews,
};

export type Messages = typeof de;

const all: Record<Locale, Messages> = { de, en: en as Messages };

export function getMessages(locale: Locale): Messages {
  return all[locale] ?? all.en;
}
