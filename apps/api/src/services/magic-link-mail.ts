import {
  MAGIC_LINK_TTL_SECONDS,
  type MailLocale,
  type WebLoginIntent,
} from "@soulwick/contracts";
import type { MailMessage } from "../lib/mail.ts";

/**
 * Text of the magic link mail (P-036, P-039), English and German. No tracking, no images, no
 * marketing. It says plainly that ANOTHER device (a game) gets signed in and that the page will ask
 * for the code that game shows, so a link somebody else requested for this address is of no use
 * to its reader (KF5 security fix). The game's code is never in the mail.
 */

const TEXT = {
  en: {
    subject: {
      sign_in: "Sign a game in to Soulwick",
      link: "Add your e-mail to a Soulwick account",
    },
    intro: {
      sign_in:
        "A game on ANOTHER device wants to sign in to Soulwick with this e-mail address.",
      link: "A game on ANOTHER device wants to add this e-mail address to its Soulwick account.",
    },
    check:
      "Only continue if you started this yourself in Soulwick: the next page asks for the code your game shows.",
    button: "Continue",
    expires: (minutes: number) =>
      `The link works once within ${minutes} minutes.`,
    ignore:
      "If that was not you, ignore this mail and never type a code someone else gives you. Nothing happens without it.",
  },
  de: {
    subject: {
      sign_in: "Ein Spiel bei Soulwick anmelden",
      link: "Deine E-Mail zu einem Soulwick-Konto hinzufügen",
    },
    intro: {
      sign_in:
        "Ein Spiel auf einem ANDEREN Gerät möchte sich mit dieser E-Mail-Adresse bei Soulwick anmelden.",
      link: "Ein Spiel auf einem ANDEREN Gerät möchte diese E-Mail-Adresse zu seinem Soulwick-Konto hinzufügen.",
    },
    check:
      "Mach nur weiter, wenn du das selbst in Soulwick gestartet hast: Die nächste Seite fragt nach dem Code, den dein Spiel zeigt.",
    button: "Weiter",
    expires: (minutes: number) =>
      `Der Link funktioniert einmal und ${minutes} Minuten lang.`,
    ignore:
      "Warst du das nicht, ignoriere diese Mail und tippe nie einen Code ein, den dir jemand anderes nennt. Ohne ihn passiert nichts.",
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
  intent: WebLoginIntent;
  locale: MailLocale;
}): MailMessage {
  const t = TEXT[input.locale];
  const minutes = Math.round(MAGIC_LINK_TTL_SECONDS / 60);
  const text = [
    t.intro[input.intent],
    "",
    t.check,
    "",
    `${t.button}: ${input.url}`,
    "",
    t.expires(minutes),
    t.ignore,
    "",
    "Soulwick · playsoulwick.com",
  ].join("\n");
  const html = `<!doctype html><html lang="${input.locale}"><body style="font-family:sans-serif;line-height:1.5">
<p><strong>${escapeHtml(t.intro[input.intent])}</strong></p>
<p>${escapeHtml(t.check)}</p>
<p><a href="${escapeHtml(input.url)}">${escapeHtml(t.button)}</a></p>
<p>${escapeHtml(t.expires(minutes))}<br>${escapeHtml(t.ignore)}</p>
<p style="color:#777">Soulwick · playsoulwick.com</p>
</body></html>`;
  return { to: input.to, subject: t.subject[input.intent], text, html };
}
