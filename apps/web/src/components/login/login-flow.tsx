"use client";

import {
  WEB_LOGIN_TTL_SECONDS,
  WEB_LOGIN_USER_CODE_LENGTH,
} from "@soulwick/contracts";
import { useTranslations } from "next-intl";
import {
  type ReactNode,
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  confirmLogin,
  openLogin,
  sendMagicLink,
} from "@/app/[locale]/login/actions";
import { WickFigure } from "@/components/wick/wick-figure";
import {
  CODE_FIELD,
  CONFIRM_FIELD,
  type ConfirmState,
  EMAIL_FIELD,
  HONEYPOT_FIELD,
  LOCALE_FIELD,
  loginError,
  type MailState,
  TYPED_CODE_FIELD,
  TYPED_CODE_MAX,
} from "@/lib/login-form";
import {
  FRAGMENT_KEY,
  KEY_WINDOW_PROPERTY,
  keyStorageName,
  LOGIN_PROVIDERS,
  type LoadResult,
  type LoginProvider,
  type LoginState,
  oauthStartAction,
} from "@/lib/login-protocol";
import {
  AccountPlaque,
  LoginPanel,
  LoginShell,
  Notice,
  Warning,
} from "./login-ui";
import { MergeView, providerLabel } from "./merge-view";
import { ProblemView } from "./problem-view";
import { ProviderButton } from "./provider-buttons";
import { SubmitButton } from "./submit-button";

export interface LoginFlowProps {
  /** Public API address for the provider forms. */
  apiBase: string;
  code: string;
  /** `?confirm=` after the proof at a provider or by magic link. */
  confirm?: string;
  /** `?error=` the API sent the browser back with (cancelled, provider error, …). */
  error?: string;
  /** Flint's idle strip, if delivered. */
  flintSrc: string | null;
  locale: string;
  magicMinutes: number;
  steamImage: string | null;
}

type Phase =
  | { kind: "loading" }
  | { kind: "problem"; problem: string }
  | { kind: "ready"; state: LoginState; browserToken: string | null };

/**
 * The page `/login/<code>` (KF11). The game opens it with the browser key in the fragment
 * (`#k=…`); an inline script has already moved the key out of the address bar into
 * sessionStorage (`fragmentScript`). `openLogin` trades it once for the browser token (an
 * httpOnly cookie of the website), then the key is forgotten. The request's state decides the
 * step: choose a login, confirm with the code from the game, done, or a problem.
 */
export function LoginFlow(props: LoginFlowProps) {
  const { code, confirm } = props;
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    openOnce(code, confirm)
      .then((result: LoadResult) => {
        if (!active) {
          return;
        }
        setPhase(
          result.ok
            ? {
                kind: "ready",
                state: result.state,
                browserToken: result.browserToken,
              }
            : { kind: "problem", problem: result.problem }
        );
      })
      .catch(() => {
        if (active) {
          setPhase({ kind: "problem", problem: "unreachable" });
        }
      });
    return () => {
      active = false;
    };
  }, [code, confirm]);

  if (phase.kind === "loading") {
    return <Loading />;
  }
  if (phase.kind === "problem") {
    return <ProblemView error={phase.problem} />;
  }
  return (
    <StateView
      {...props}
      browserToken={phase.browserToken}
      onChange={(state) => setPhase({ ...phase, state })}
      state={phase.state}
    />
  );
}

/** One `openLogin` per code and confirm secret at a time (a claim works only once). */
const opening = new Map<string, Promise<LoadResult>>();

function openOnce(code: string, confirm: string | undefined) {
  const id = `${code}|${confirm ?? ""}`;
  const running = opening.get(id);
  if (running) {
    return running;
  }
  const key = takeBrowserKey(code);
  const promise = openLogin({ code, key: key ?? undefined, confirm }).then(
    (result) => {
      // Traded or useless now; keep it only when the server could not be asked.
      const retry =
        !result.ok &&
        (result.problem === "unreachable" || result.problem === "rate_limited");
      if (key && !retry) {
        forgetBrowserKey(code);
      }
      return result;
    }
  );
  opening.set(id, promise);
  promise.finally(() => opening.delete(id)).catch(() => undefined);
  return promise;
}

/** The key the inline script kept, else (script blocked) whatever is still in the fragment. */
function takeBrowserKey(code: string): string | null {
  const fromWindow = (window as unknown as Record<string, unknown>)[
    KEY_WINDOW_PROPERTY
  ];
  if (typeof fromWindow === "string" && fromWindow) {
    return fromWindow;
  }
  try {
    const stored = window.sessionStorage.getItem(keyStorageName(code));
    if (stored) {
      return stored;
    }
  } catch {
    // Storage off: fall through to the fragment.
  }
  const fromFragment = new URLSearchParams(window.location.hash.slice(1)).get(
    FRAGMENT_KEY
  );
  if (fromFragment) {
    const { pathname, search } = window.location;
    window.history.replaceState(
      window.history.state,
      "",
      `${pathname}${search}`
    );
  }
  return fromFragment;
}

function forgetBrowserKey(code: string) {
  (window as unknown as Record<string, unknown>)[KEY_WINDOW_PROPERTY] =
    undefined;
  try {
    window.sessionStorage.removeItem(keyStorageName(code));
  } catch {
    // Nothing kept.
  }
}

function StateView({
  state,
  browserToken,
  onChange,
  ...props
}: LoginFlowProps & {
  state: LoginState;
  browserToken: string | null;
  onChange: (state: LoginState) => void;
}) {
  const t = useTranslations("login");
  switch (state.status) {
    case "pending":
      return state.restricted || !browserToken ? (
        <Message text={t("noKey.text")} title={t("noKey.title")} />
      ) : (
        <PendingView {...props} browserToken={browserToken} state={state} />
      );
    case "awaiting_confirm":
      return state.restricted || !props.confirm ? (
        <Message
          text={t("confirm.waitingText")}
          title={t("confirm.waitingTitle")}
        />
      ) : (
        <ConfirmView
          confirm={props.confirm}
          onChange={onChange}
          state={state}
        />
      );
    case "completed":
      return <DoneView flintSrc={props.flintSrc} state={state} />;
    case "failed":
      return <ProblemView ban={state.ban} error={state.error} />;
    default:
      return <ProblemView error="expired" />;
  }
}

// --- choose a login ------------------------------------------------------------------------------

function PendingView({
  state,
  browserToken,
  apiBase,
  error,
  locale,
  magicMinutes,
  steamImage,
}: LoginFlowProps & { state: LoginState; browserToken: string }) {
  const t = useTranslations("login");
  const providers = LOGIN_PROVIDERS.filter((p) => state.methods.includes(p));
  const hasEmail = state.methods.includes("email");
  const errorKey = error ? loginError(error) : null;

  return (
    <LoginShell
      eyebrow={t("eyebrow")}
      title={
        state.intent === "link"
          ? t("pending.titleLink")
          : t("pending.titleSignIn")
      }
    >
      <p className="lead text-balance text-center">
        {state.intent === "link"
          ? t("pending.leadLink")
          : t("pending.leadSignIn")}
      </p>

      <Warning title={t("pending.warningTitle")}>
        {t("pending.warning")}
      </Warning>

      <LoginPanel>
        {errorKey ? (
          <Notice live title={t(`errors.${errorKey}.title`)}>
            {t(`errors.${errorKey}.text`, {
              codeMinutes: Math.round(WEB_LOGIN_TTL_SECONDS / 60),
              linkMinutes: magicMinutes,
            })}
          </Notice>
        ) : null}

        {providers.length > 0 || hasEmail ? (
          <h2 className="text-text text-xl sm:text-2xl">
            {t("pending.methodsTitle")}
          </h2>
        ) : (
          <p className="text-soft">{t("pending.noMethods")}</p>
        )}

        {providers.length > 0 ? (
          <ul
            aria-label={t("pending.providersLabel")}
            className="flex flex-col gap-3"
          >
            {providers.map((provider: LoginProvider) => (
              <li key={provider}>
                <ProviderButton
                  action={oauthStartAction(apiBase, provider)}
                  browserToken={browserToken}
                  code={state.code}
                  label={t(`providers.${provider}`)}
                  provider={provider}
                  steamImage={steamImage}
                />
              </li>
            ))}
          </ul>
        ) : null}

        {providers.length > 0 && hasEmail ? (
          <div
            aria-hidden="true"
            className="flex items-center gap-3 text-muted text-sm"
          >
            <span className="h-0.5 flex-1 bg-line" />
            <span className="font-pixel">{t("pending.or")}</span>
            <span className="h-0.5 flex-1 bg-line" />
          </div>
        ) : null}

        {hasEmail ? (
          <EmailForm code={state.code} locale={locale} minutes={magicMinutes} />
        ) : null}
      </LoginPanel>

      <div className="flex flex-col gap-2 text-center text-muted text-sm">
        {state.intent === "sign_in" ? <p>{t("pending.newAccount")}</p> : null}
        <ValidFor expiresAt={state.expiresAt} />
      </div>
    </LoginShell>
  );
}

const inputClass =
  "w-full rounded-[3px] border-2 border-line bg-bg-deep px-3 py-2.5 text-text placeholder:text-disabled hover:border-line-light aria-invalid:border-danger";

function EmailForm({
  code,
  locale,
  minutes,
}: {
  code: string;
  locale: string;
  minutes: number;
}) {
  const t = useTranslations("login.email");
  const uid = useId();
  const [state, action] = useActionState<MailState, FormData>(sendMagicLink, {
    status: "idle",
  });
  const [again, setAgain] = useState(0);
  const sentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.status === "sent") {
      sentRef.current?.focus();
    }
  }, [state]);

  if (state.status === "sent" && again === 0) {
    return (
      <div
        className="flex flex-col items-start gap-3 outline-none"
        ref={sentRef}
        tabIndex={-1}
      >
        <Notice live title={t("sentTitle")} tone="calm">
          {t("sentText")}
        </Notice>
        <button
          className="btn btn-sm"
          onClick={() => setAgain(1)}
          type="button"
        >
          {t("again")}
        </button>
      </div>
    );
  }

  const error = state.status === "error" ? state.notice : null;
  return (
    <form
      action={(formData) => {
        setAgain(0);
        action(formData);
      }}
      className="flex flex-col gap-3"
      id="email"
    >
      <input name={CODE_FIELD} type="hidden" value={code} />
      <input name={LOCALE_FIELD} type="hidden" value={locale} />
      <div className="flex flex-col gap-1.5">
        <label className="font-bold text-text" htmlFor={`${uid}-email`}>
          {t("label")}
        </label>
        <p className="text-muted text-sm" id={`${uid}-hint`}>
          {t("hint", { minutes })}
        </p>
        <input
          aria-describedby={`${uid}-hint${error ? ` ${uid}-error` : ""}`}
          aria-invalid={error === "invalid" ? true : undefined}
          autoComplete="email"
          className={inputClass}
          defaultValue={state.status === "error" ? state.email : ""}
          id={`${uid}-email`}
          inputMode="email"
          maxLength={254}
          name={EMAIL_FIELD}
          placeholder={t("placeholder")}
          required
          spellCheck={false}
          type="email"
        />
        {error ? (
          <p className="text-danger text-sm" id={`${uid}-error`} role="alert">
            {t(`notices.${error}`)}
          </p>
        ) : null}
      </div>
      {/* Bot trap: off-screen and skipped by keyboard and screen readers. */}
      <div
        aria-hidden="true"
        className="absolute -left-[9999px] h-px w-px overflow-hidden"
      >
        <label htmlFor={`${uid}-${HONEYPOT_FIELD}`}>{t("honeypot")}</label>
        <input
          autoComplete="off"
          defaultValue=""
          id={`${uid}-${HONEYPOT_FIELD}`}
          name={HONEYPOT_FIELD}
          tabIndex={-1}
          type="text"
        />
      </div>
      <SubmitButton
        busyLabel={t("submitting")}
        className="btn w-full"
        label={t("submit")}
      />
    </form>
  );
}

// --- confirm with the code from the game ----------------------------------------------------------

function ConfirmView({
  state,
  confirm,
  onChange,
}: {
  state: LoginState;
  confirm: string;
  onChange: (state: LoginState) => void;
}) {
  const t = useTranslations("login");
  const uid = useId();
  const [result, action] = useActionState<ConfirmState, FormData>(
    confirmLogin,
    { status: "idle" }
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const handled = useRef<ConfirmState | null>(null);

  useEffect(() => {
    if (handled.current === result) {
      return;
    }
    handled.current = result;
    if (result.status === "done") {
      onChange(result.state);
    } else if (result.status === "error") {
      inputRef.current?.focus();
    }
  }, [result, onChange]);

  const merge = state.merge;
  const isLink = state.intent === "link";
  // An empty account being absorbed needs no comparison, only a note (D-122).
  const realMerge = merge && merge.bothHaveProgress !== false ? merge : null;
  // `account` is where the game ends up; after a real merge that is the account that stays.
  let statement = t("confirm.signIn");
  if (isLink && !realMerge) {
    statement = t("confirm.link");
  } else if (!isLink && (state.newAccount || !state.account)) {
    statement = t("confirm.signInNew");
  }
  const error = result.status === "error" ? result : null;

  return (
    <LoginShell
      eyebrow={t("confirm.eyebrow")}
      title={isLink ? t("confirm.titleLink") : t("confirm.titleSignIn")}
    >
      <PixelCard>
        <p className="font-pixel text-lg text-soft sm:text-xl">{statement}</p>
        {state.account ? (
          <p className="text-3xl sm:text-4xl">
            <AccountPlaque
              levelLabel={levelLabel(t, state.account.level)}
              name={state.account.name}
            />
          </p>
        ) : (
          <p className="text-sm text-soft">{t("confirm.newAccountHint")}</p>
        )}
        {state.provider ? (
          <p className="text-muted text-sm">
            {t("confirm.provider", {
              provider: providerLabel(t, state.provider),
            })}
          </p>
        ) : null}
      </PixelCard>

      <Warning title={t("confirm.warningTitle")}>
        {t("confirm.warning")}
      </Warning>

      <LoginPanel>
        {realMerge ? <MergeView merge={realMerge} /> : null}
        {merge && !realMerge ? (
          <p className="text-sm text-soft">{t("confirm.absorbHint")}</p>
        ) : null}

        <form action={action} className="flex flex-col gap-4">
          <input name={CODE_FIELD} type="hidden" value={state.code} />
          <input name={CONFIRM_FIELD} type="hidden" value={confirm} />
          <div className="flex flex-col gap-1.5">
            <label className="font-bold text-text" htmlFor={`${uid}-code`}>
              {t("confirm.codeLabel")}
            </label>
            <p className="text-muted text-sm" id={`${uid}-hint`}>
              {t("confirm.codeHint", { length: WEB_LOGIN_USER_CODE_LENGTH })}
            </p>
            <input
              aria-describedby={`${uid}-hint${error ? ` ${uid}-error` : ""}`}
              aria-invalid={error ? true : undefined}
              autoCapitalize="characters"
              autoComplete="one-time-code"
              className={`${inputClass} text-center font-pixel text-2xl uppercase tracking-[0.3em] placeholder:tracking-[0.3em] sm:text-3xl`}
              id={`${uid}-code`}
              maxLength={TYPED_CODE_MAX}
              name={TYPED_CODE_FIELD}
              placeholder={t("confirm.codePlaceholder")}
              ref={inputRef}
              required
              spellCheck={false}
              type="text"
            />
            {error ? (
              <p
                className="text-danger text-sm"
                id={`${uid}-error`}
                role="alert"
              >
                {t(`confirm.notices.${error.notice}`, {
                  length: WEB_LOGIN_USER_CODE_LENGTH,
                })}
                {error.attemptsLeft === null
                  ? null
                  : ` ${t("confirm.notices.attemptsLeft", { count: error.attemptsLeft })}`}
              </p>
            ) : null}
          </div>
          <SubmitButton
            busyLabel={t("confirm.submitting")}
            label={realMerge ? t("confirm.submitMerge") : t("confirm.submit")}
          />
        </form>
      </LoginPanel>
      <p className="text-center text-muted text-sm">
        <ValidFor expiresAt={state.expiresAt} />
      </p>
    </LoginShell>
  );
}

// --- done, messages, loading -------------------------------------------------------------------------

function DoneView({
  state,
  flintSrc,
}: {
  state: LoginState;
  flintSrc: string | null;
}) {
  const t = useTranslations("login");
  const headingRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  return (
    <LoginShell
      eyebrow={t("eyebrow")}
      sprite="soul_flame_6f"
      title={t("done.title")}
    >
      <LoginPanel className="items-center text-center">
        <div
          className="flex flex-col items-center gap-4 outline-none"
          ref={headingRef}
          role="status"
          tabIndex={-1}
        >
          <WickFigure
            className="drop-shadow-[0_0_24px_rgb(255_181_74/0.5)]"
            scale={4}
            src={flintSrc}
          />
          <p className="lead">
            {state.result === "linked" ? t("done.linked") : t("done.signedIn")}
          </p>
          {state.merged ? (
            <p className="text-gold">{t("done.merged")}</p>
          ) : null}
          {state.provider ? (
            <p className="text-muted text-sm">
              {t("done.via", { provider: providerLabel(t, state.provider) })}
            </p>
          ) : null}
        </div>
        <a className="btn btn-sm" href="/">
          {t("done.home")}
        </a>
      </LoginPanel>
    </LoginShell>
  );
}

function Message({ title, text }: { title: string; text: string }) {
  const t = useTranslations("login");
  return (
    <LoginShell eyebrow={t("eyebrow")} title={title}>
      <LoginPanel>
        <p className="lead">{text}</p>
        <a className="btn btn-sm self-start" href="/">
          {t("problem.home")}
        </a>
      </LoginPanel>
    </LoginShell>
  );
}

function Loading() {
  const t = useTranslations("login");
  return (
    <LoginShell eyebrow={t("eyebrow")} title={t("pending.titleSignIn")}>
      <LoginPanel className="items-center">
        <p aria-live="polite" className="text-soft" role="status">
          {t("loading")}
        </p>
      </LoginPanel>
    </LoginShell>
  );
}

function PixelCard({ children }: { children: ReactNode }) {
  return (
    <div className="pixel-panel-gold flex flex-col items-center gap-2 px-5 py-6 text-center">
      {children}
    </div>
  );
}

function ValidFor({ expiresAt }: { expiresAt: string | null }) {
  const t = useTranslations("login");
  if (!expiresAt) {
    return null;
  }
  const minutes = Math.max(
    0,
    Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 60_000)
  );
  return <span>{t("validFor", { minutes })}</span>;
}

function levelLabel(
  t: ReturnType<typeof useTranslations<"login">>,
  level: number | null | undefined
): string | null {
  return typeof level === "number" ? t("level", { level }) : null;
}
