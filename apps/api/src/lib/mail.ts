import type { Config } from "../config.ts";
import { ApiError, withCause } from "./errors.ts";
import type { Logger } from "./logger.ts";

/**
 * Mail adapter for magic links (D-196, P-039). The API never speaks SMTP itself: in production
 * it hands each mail to a small Cloudflare Worker (`MAIL_ADAPTER=cloudflare`), which sends it
 * with Cloudflare's e-mail sending. Locally `log` writes the mail to the API log. A different
 * provider only needs another adapter here; SMTP (Nodemailer) would be a new dependency.
 *
 * Worker contract: `POST <MAIL_CLOUDFLARE_URL>` with `Authorization: Bearer <MAIL_CLOUDFLARE_KEY>`
 * and JSON `{ from, to, subject, text, html }`; any 2xx means accepted.
 */

export interface MailMessage {
  html: string;
  subject: string;
  text: string;
  to: string;
}

export interface Mailer {
  /** false = mails are switched off (`MAIL_ADAPTER=off`), magic links answer 501. */
  readonly enabled: boolean;
  send: (message: MailMessage) => Promise<void>;
}

const unavailable = (cause: unknown) =>
  withCause(
    new ApiError(502, "mail_unavailable", "The mail could not be sent"),
    cause
  );

/** "lu***@example.org": enough to recognise an address in logs and the account panel. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) {
    return "***";
  }
  return `${email.slice(0, Math.min(2, at))}***${email.slice(at)}`;
}

export function createMailer(
  config: Pick<
    Config,
    | "MAIL_ADAPTER"
    | "MAIL_FROM"
    | "MAIL_CLOUDFLARE_URL"
    | "MAIL_CLOUDFLARE_KEY"
    | "EXTERNAL_AUTH_TIMEOUT_MS"
  >,
  deps: { fetch?: typeof fetch; logger: Logger }
): Mailer {
  switch (config.MAIL_ADAPTER) {
    case "log":
      return {
        enabled: true,
        send(message) {
          // Development only (refused in production by config.ts): the link is the point here.
          deps.logger.info("mail_logged", {
            to: message.to,
            subject: message.subject,
            text: message.text,
          });
          return Promise.resolve();
        },
      };
    case "cloudflare":
      return {
        enabled: true,
        async send(message) {
          const doFetch = deps.fetch ?? fetch;
          let res: Response;
          try {
            res = await doFetch(config.MAIL_CLOUDFLARE_URL, {
              method: "POST",
              headers: {
                authorization: `Bearer ${config.MAIL_CLOUDFLARE_KEY}`,
                "content-type": "application/json",
              },
              body: JSON.stringify({ from: config.MAIL_FROM, ...message }),
              signal: AbortSignal.timeout(config.EXTERNAL_AUTH_TIMEOUT_MS),
            });
          } catch (err) {
            throw unavailable(err);
          }
          if (!res.ok) {
            throw unavailable(new Error(`mail worker HTTP ${res.status}`));
          }
        },
      };
    default:
      return {
        enabled: false,
        send() {
          return Promise.reject(
            new ApiError(
              501,
              "provider_not_configured",
              "Mail is not configured on this server"
            )
          );
        },
      };
  }
}
