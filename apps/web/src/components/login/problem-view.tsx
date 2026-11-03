import {
  MAGIC_LINK_TTL_SECONDS,
  WEB_LOGIN_TTL_SECONDS,
} from "@soulwick/contracts";
import { useFormatter, useTranslations } from "next-intl";
import { type LoginError, loginError } from "@/lib/login-form";
import { LoginPanel, LoginShell } from "./login-ui";

/**
 * A sign-in that cannot go on (`/login?error=…`, a failed or expired request): what happened in
 * one sentence and what to do next, which is always "start again in the game". A ban shows its
 * reason and end. Usable from Server and Client Components.
 */
export function ProblemView({
  error,
  ban,
}: {
  error: string | null | undefined;
  ban?: { reason: string | null; expiresAt: string | null } | null;
}) {
  const t = useTranslations("login");
  const key: LoginError = loginError(error);
  return (
    <LoginShell
      eyebrow={t("eyebrow")}
      sprite="soul_flame_dying_6f"
      title={t(`errors.${key}.title`)}
    >
      <LoginPanel>
        <ProblemText ban={ban} errorKey={key} />
        <a className="btn btn-sm self-start" href="/">
          {t("problem.home")}
        </a>
      </LoginPanel>
    </LoginShell>
  );
}

export function ProblemText({
  errorKey,
  ban,
}: {
  errorKey: LoginError;
  ban?: { reason: string | null; expiresAt: string | null } | null;
}) {
  const t = useTranslations("login");
  const format = useFormatter();
  const minutes = {
    codeMinutes: Math.round(WEB_LOGIN_TTL_SECONDS / 60),
    linkMinutes: Math.round(MAGIC_LINK_TTL_SECONDS / 60),
  };
  const isBan = errorKey === "banned";
  return (
    <div className="flex flex-col gap-3" role="status">
      <p className="lead">{t(`errors.${errorKey}.text`, minutes)}</p>
      {isBan && ban?.reason ? (
        <p className="break-words text-text">
          {t("problem.banReason", { reason: ban.reason })}
        </p>
      ) : null}
      {isBan && ban ? (
        <p className="text-soft">
          {ban.expiresAt
            ? t("problem.banUntil", {
                date: format.dateTime(new Date(ban.expiresAt), {
                  dateStyle: "long",
                  timeStyle: "short",
                }),
              })
            : t("problem.banPermanent")}
        </p>
      ) : null}
      {isBan ? null : <p className="text-soft">{t("problem.again")}</p>}
    </div>
  );
}
