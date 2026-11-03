import {
  MAGIC_LINK_TTL_SECONDS,
  type MailLocale,
  type WebLoginIntent,
} from "@soulwick/contracts";
import type { MailMessage } from "../lib/mail.ts";
import { formatWebLoginCode } from "./web-login.ts";

/**
 * Text of the magic link mail (P-036, P-039), English and German. No tracking, no images, no
 * marketing: the code of the request (the game shows the same) and the link, and the hint to
 * ignore the mail when nobody asked for it (someone may have typed the address by mistake).
 */

const TEXT = {
  en: {
    subject: {
      sign_in: "Your Soulwick sign-in link",
      link: "Confirm your e-mail for Soulwick",
    },
    intro: {
      sign_in: "Someone wants to sign in to Soulwick with this e-mail address.",
      link: "Someone wants to add this e-mail address to a Soulwick account.",
    },
    code: "Code shown in the game",
    button: "Continue",
    expires: (minutes: number) =>
      `The link works once within ${minutes} minutes.`,
    ignore:
      "If that was not you, ignore this mail. Nothing happens without the link.",
  },
  de: {
    subject: {
      sign_in: "Dein Anmeldelink für Soulwick",
      link: "Bestätige deine E-Mail für Soulwick",
    },
    intro: {
      sign_in:
        "Jemand möchte sich mit dieser E-Mail-Adresse bei Soulwick anmelden.",
      link: "Jemand möchte diese E-Mail-Adresse zu einem Soulwick-Konto hinzufügen.",
    },
    code: "Code im Spiel",
    button: "Weiter",
    expires: (minutes: number) =>
      `Der Link funktioniert einmal und ${minutes} Minuten lang.`,
    ignore:
      "Warst du das nicht, ignoriere diese Mail. Ohne den Link passiert nichts.",
  },
} as const;

const escapeHtml = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export function magicLinkMail(input: {
  to: string;
  url: string;
  code: string;
  intent: WebLoginIntent;
  locale: MailLocale;
}): MailMessage {
  const t = TEXT[input.locale];
  const minutes = Math.round(MAGIC_LINK_TTL_SECONDS / 60);
  const code = formatWebLoginCode(input.code);
  const text = [
    t.intro[input.intent],
    "",
    `${t.code}: ${code}`,
    "",
    `${t.button}: ${input.url}`,
    "",
    t.expires(minutes),
    t.ignore,
    "",
    "Soulwick · playsoulwick.com",
  ].join("\n");
  const html = `<!doctype html><html lang="${input.locale}"><body style="font-family:sans-serif;line-height:1.5">
<p>${escapeHtml(t.intro[input.intent])}</p>
<p>${escapeHtml(t.code)}: <strong style="font-family:monospace;font-size:1.2em">${code}</strong></p>
<p><a href="${escapeHtml(input.url)}">${escapeHtml(t.button)}</a></p>
<p>${escapeHtml(t.expires(minutes))}<br>${escapeHtml(t.ignore)}</p>
<p style="color:#777">Soulwick · playsoulwick.com</p>
</body></html>`;
  return { to: input.to, subject: t.subject[input.intent], text, html };
}
