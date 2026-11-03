import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LoginPanel, LoginShell } from "@/components/login/login-ui";
import { ProblemView } from "@/components/login/problem-view";
import { param } from "@/lib/login";

/** `?error=` changes per request. */
export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("login");
  return { title: t("meta.errorTitle") };
}

/**
 * `/login?error=<code>`: where the API sends the browser when a sign-in has no usable request
 * (unknown code, broken provider round trip, used magic link). Without `error` it explains that
 * signing in starts in the game.
 */
export default async function LoginErrorRoute({ searchParams }: Props) {
  const error = param((await searchParams).error);
  if (error) {
    return <ProblemView error={error} />;
  }
  const t = await getTranslations("login");
  return (
    <LoginShell eyebrow={t("eyebrow")} title={t("errorPage.title")}>
      <LoginPanel>
        <p className="lead">{t("errorPage.text")}</p>
        <a className="btn btn-sm self-start" href="/">
          {t("problem.home")}
        </a>
      </LoginPanel>
    </LoginShell>
  );
}
