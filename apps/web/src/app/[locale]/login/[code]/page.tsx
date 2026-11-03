import { MAGIC_LINK_TTL_SECONDS } from "@soulwick/contracts";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { LoginFlow } from "@/components/login/login-flow";
import { ProblemView } from "@/components/login/problem-view";
import { brand } from "@/lib/brand";
import { apiPublicUrl, param, parseCode } from "@/lib/login";

/** Per request: the API address and the delivered art are read on the server at runtime. */
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("login");
  return { title: t("meta.title"), description: t("meta.description") };
}

/**
 * `/login/<code>` (KF11): the page the game opens for the web login (`#k=` browser key) and
 * where the API sends the browser back after Google, Apple, Discord, Steam or a magic link
 * (`?confirm=`, `?error=`). The inline script in the `<head>` of the root layout (`FRAGMENT_SCRIPT`)
 * takes `#k=` out of the address bar before anything is painted; the steps run in `LoginFlow` because the key exists
 * only in the browser.
 */
export default async function LoginCodeRoute({ params, searchParams }: Props) {
  const code = parseCode((await params).code);
  if (!code) {
    return <ProblemView error="web_login_not_found" />;
  }
  const query = await searchParams;
  const t = await getTranslations("login");
  return (
    <>
      <noscript>
        <p className="container-site pt-6 text-center text-danger">
          {t("noScript")}
        </p>
      </noscript>
      <LoginFlow
        apiBase={apiPublicUrl()}
        code={code}
        confirm={param(query.confirm)}
        error={param(query.error)}
        flintSrc={brand.wick().idle}
        locale={await getLocale()}
        magicMinutes={Math.round(MAGIC_LINK_TTL_SECONDS / 60)}
        steamImage={brand.steamSignIn()}
      />
    </>
  );
}
