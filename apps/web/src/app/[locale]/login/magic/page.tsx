import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import {
  LoginPanel,
  LoginShell,
  Notice,
  Warning,
} from "@/components/login/login-ui";
import { ProblemView } from "@/components/login/problem-view";
import { SubmitButton } from "@/components/login/submit-button";
import { fetchMagicPreview, param, parseMagicToken } from "@/lib/login";
import { TOKEN_FIELD } from "@/lib/login-form";
import { verifyMagicLink } from "../actions";

/** The token is checked against the API on every request. */
export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("login");
  return { title: t("meta.magicTitle") };
}

const NOTICES = new Set(["rate_limited", "unreachable"]);

/**
 * `/login/magic?token=` (KF11): the link from the mail. Opening it changes nothing (mail scanners
 * open links too); the preview says that another device gets signed in, and only the button
 * uses the link up. Then the request's page asks for the code from the game. Works without
 * JavaScript.
 */
export default async function MagicLinkRoute({ searchParams }: Props) {
  const query = await searchParams;
  const token = parseMagicToken(param(query.token));
  if (!token) {
    return <ProblemView error="invalid_magic_link" />;
  }
  const preview = await fetchMagicPreview(token);
  if (!preview.ok) {
    return (
      <ProblemView
        error={preview.status === 400 ? "invalid_magic_link" : "unreachable"}
      />
    );
  }
  const t = await getTranslations("login");
  const notice = param(query.error);
  const { account, intent } = preview.data;

  return (
    <LoginShell eyebrow={t("magic.eyebrow")} title={t("magic.title")}>
      <p className="lead text-balance text-center">
        {intent === "link" && account
          ? t.rich("magic.textLink", {
              account: () => (
                <span className="break-all font-pixel text-gold">
                  {account.name}
                </span>
              ),
            })
          : t("magic.textSignIn")}
      </p>
      <Warning title={t("magic.warningTitle")}>{t("magic.warning")}</Warning>
      <LoginPanel>
        {notice && NOTICES.has(notice) ? (
          <Notice live>
            {t(`magic.notices.${notice as "rate_limited" | "unreachable"}`)}
          </Notice>
        ) : null}
        <form action={verifyMagicLink}>
          <input name={TOKEN_FIELD} type="hidden" value={token} />
          <SubmitButton
            busyLabel={t("magic.submitting")}
            label={t("magic.submit")}
          />
        </form>
      </LoginPanel>
    </LoginShell>
  );
}
