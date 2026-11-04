import localFont from "next/font/local";
import { LOGIN_API, type LoginProvider } from "@/lib/login-protocol";

/**
 * Sign-in buttons after the providers' brand rules (KF11). Each one is a small form that posts
 * `code` and `browserToken` to the API (`POST /auth/oauth/<provider>/start`, form-urlencoded);
 * the API answers 303 to the provider. No GET links: the token never lands in a URL, history or
 * log. All four have the same size, so none is less prominent than another (Apple's rule):
 * - Google: light theme, the four-colour "G" unchanged on white, Roboto Medium, "Continue with
 *   Google" in the page language (Google's sign-in branding guidelines).
 * - Apple: white style for dark backgrounds, Apple logo and system font, "Continue with Apple"
 *   (Apple's Human Interface Guidelines, Sign in with Apple).
 * - Discord: Blurple with the white Discord logo (Discord brand guidelines).
 * - Steam: "Sign in through Steam" unchanged in every language; Valve's official button image
 *   when it is in `public/brand/login/steam_signin.webp`, until then a text button in Steam's
 *   colours without the Steam logo.
 */
/** Roboto (OFL) self-hosted like the site's faces (`src/app/fonts.ts`); the button uses weight 500. */
const roboto = localFont({
  src: "../../../public/brand/fonts/Roboto-Variable.ttf",
  weight: "100 900",
  display: "swap",
});

const base =
  "flex min-h-12 w-full cursor-pointer items-center justify-center gap-3 rounded-[4px] px-4 text-[15px] leading-5 transition-colors duration-100";

const appleFont = {
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif',
};

export function ProviderButton({
  provider,
  action,
  code,
  browserToken,
  label,
  steamImage,
}: {
  provider: LoginProvider;
  /** `oauthStartAction(apiBase, provider)`. */
  action: string;
  code: string;
  browserToken: string;
  label: string;
  /** Official "Sign in through Steam" image, if delivered. */
  steamImage: string | null;
}) {
  return (
    <form action={action} method="post">
      <input name={LOGIN_API.oauthCodeField} type="hidden" value={code} />
      <input
        name={LOGIN_API.oauthTokenField}
        type="hidden"
        value={browserToken}
      />
      <ButtonFace label={label} provider={provider} steamImage={steamImage} />
    </form>
  );
}

function ButtonFace({
  provider,
  label,
  steamImage,
}: {
  provider: LoginProvider;
  label: string;
  steamImage: string | null;
}) {
  switch (provider) {
    case "google":
      return (
        <button
          className={`${base} ${roboto.className} border border-[#747775] bg-white font-medium text-[#1f1f1f] hover:bg-[#f2f2f2]`}
          type="submit"
        >
          <GoogleLogo />
          <span>{label}</span>
        </button>
      );
    case "apple":
      return (
        <button
          className={`${base} bg-white font-medium text-black hover:bg-[#ededed]`}
          style={appleFont}
          type="submit"
        >
          <AppleLogo />
          <span>{label}</span>
        </button>
      );
    case "discord":
      return (
        <button
          className={`${base} bg-[#5865f2] font-bold text-white hover:bg-[#4752c4]`}
          type="submit"
        >
          <DiscordLogo />
          <span>{label}</span>
        </button>
      );
    default:
      return steamImage ? (
        <button
          className="flex min-h-12 w-full cursor-pointer items-center justify-center rounded-[4px] bg-[#171a21] px-4 py-2 hover:bg-[#1b2838]"
          type="submit"
        >
          {/* biome-ignore lint/performance/noImgElement: Valve's button image is shown unchanged, at its own size. */}
          <img
            alt={label}
            className="h-auto max-w-full"
            height={35}
            src={steamImage}
            style={{ imageRendering: "auto" }}
            width={180}
          />
        </button>
      ) : (
        <button
          className={`${base} border border-[#3d4450] bg-[linear-gradient(180deg,#2a475e_0%,#171a21_100%)] font-bold text-white hover:bg-[linear-gradient(180deg,#356083_0%,#1b2838_100%)]`}
          type="submit"
        >
          <span>{label}</span>
        </button>
      );
  }
}

/** Google "G", standard colours (from Google's sign-in button). */
function GoogleLogo() {
  return (
    <svg aria-hidden="true" className="size-5 shrink-0" viewBox="0 0 48 48">
      <path
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
        fill="#EA4335"
      />
      <path
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
        fill="#4285F4"
      />
      <path
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
        fill="#FBBC05"
      />
      <path
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
        fill="#34A853"
      />
    </svg>
  );
}

function AppleLogo() {
  return (
    <svg
      aria-hidden="true"
      className="h-5 w-4 shrink-0"
      fill="currentColor"
      viewBox="0 0 814 1000"
    >
      <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z" />
    </svg>
  );
}

function DiscordLogo() {
  return (
    <svg
      aria-hidden="true"
      className="h-[18px] w-6 shrink-0"
      fill="currentColor"
      viewBox="0 0 127.14 96.36"
    >
      <path d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0a105.89 105.89 0 0 0-26.25 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15zM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69z" />
    </svg>
  );
}
