"use client";

import { useFormatter, useTranslations } from "next-intl";
import {
  Fragment,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useActionState,
  useEffect,
  useId,
  useRef,
} from "react";
import { submitDeletionStep } from "@/app/delete-account/actions";
import { PixelPanel } from "@/components/ui/pixel-panel";
import { Sprite } from "@/components/ui/sprite";
import {
  CONFIRM_FIELD,
  DELETION_LIMITS,
  type DeletionFieldError,
  type DeletionFormState,
  type DeletionFormValues,
  type DeletionNotice,
  type DeletionPreview,
  EMPTY_VALUES,
  HONEYPOT_FIELD,
  INTENT_FIELD,
  PREVIEW_GUILD_NAME_FIELD,
  PREVIEW_GUILD_TAG_FIELD,
  previewGuilds,
} from "@/lib/deletion-form";

const INITIAL_STATE: DeletionFormState = { status: "idle" };

const inputClass =
  "w-full rounded-[3px] border-2 border-line bg-bg-deep px-3 py-2.5 text-text placeholder:text-disabled hover:border-line-light aria-invalid:border-danger";

/** Secondary button with a danger ring (TOKENS.md §6); text stays on a dark surface for contrast. */
const dangerButtonClass =
  "btn w-full bg-danger/20 shadow-[0_0_0_2px_var(--color-ink),0_4px_0_2px_var(--color-ink),inset_0_0_0_2px_var(--color-danger)] hover:bg-danger/35 hover:shadow-[0_0_0_2px_var(--color-ink),0_2px_0_2px_var(--color-ink),inset_0_0_0_2px_var(--color-danger)] focus-visible:bg-danger/35 disabled:cursor-wait sm:w-auto";

/**
 * Two-step account deletion (P-026): check player name + code, then confirm. Every step posts to
 * one Server Action, so the flow also works without JavaScript; with JavaScript it stays on the
 * page and moves focus to the new step.
 */
export function DeletionFlow({
  codeMinutes,
  confirmMinutes,
}: {
  /** Lifetime of the code from the game, for the hint text. */
  codeMinutes: number;
  /** Lifetime of the confirmation step. */
  confirmMinutes: number;
}) {
  const [state, action, pending] = useActionState(
    submitDeletionStep,
    INITIAL_STATE,
    // Without JavaScript the page reloads; the fragment scrolls back to the panel.
    "/delete-account#loeschen"
  );
  const focusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.status !== "idle") {
      focusRef.current?.focus();
    }
  }, [state]);

  if (state.status === "deleted") {
    return <Deleted deletedAt={state.deletedAt} focusRef={focusRef} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <StepList current={state.status === "confirm" ? 2 : 1} />
      {state.status === "confirm" ? (
        <ConfirmStep
          account={state.account}
          action={action}
          confirmation={state.confirmation}
          confirmMinutes={confirmMinutes}
          failed={state.failed}
          focusRef={focusRef}
          pending={pending}
        />
      ) : (
        <VerifyStep
          action={action}
          codeMinutes={codeMinutes}
          fieldErrors={state.status === "verify" ? state.fieldErrors : {}}
          focusRef={focusRef}
          notice={state.status === "verify" ? state.notice : undefined}
          pending={pending}
          values={state.status === "verify" ? state.values : EMPTY_VALUES}
        />
      )}
    </div>
  );
}

function StepList({ current }: { current: 1 | 2 }) {
  const t = useTranslations("deletion.steps");
  const steps = [t("verify"), t("confirm")];
  return (
    <ol aria-label={t("label")} className="grid grid-cols-2 gap-2">
      {steps.map((label, index) => {
        const active = index + 1 === current;
        return (
          <li
            aria-current={active ? "step" : undefined}
            className={`flex items-center gap-2 border-b-2 pb-2 text-sm ${active ? "border-gold text-text" : "border-line text-muted"}`}
            key={label}
          >
            <span
              className={`font-pixel text-base ${active ? "text-gold" : ""}`}
            >
              {index + 1}
            </span>
            <span>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

// --- step 1: player name + code ------------------------------------------------------------------

function VerifyStep({
  action,
  values,
  fieldErrors,
  notice,
  pending,
  codeMinutes,
  focusRef,
}: {
  action: (formData: FormData) => void;
  values: DeletionFormValues;
  fieldErrors: Partial<Record<keyof DeletionFormValues, DeletionFieldError>>;
  notice?: DeletionNotice;
  pending: boolean;
  codeMinutes: number;
  focusRef: RefObject<HTMLDivElement | null>;
}) {
  const t = useTranslations("deletion.form");
  const uid = useId();
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;
  const errorText = (error: DeletionFieldError | undefined) => {
    if (error === "nameLength") {
      return t("errors.nameLength", {
        min: DELETION_LIMITS.playerNameMin,
        max: DELETION_LIMITS.playerNameMax,
      });
    }
    return error === "codeFormat" ? t("errors.codeFormat") : undefined;
  };
  const ids = (field: keyof DeletionFormValues) => ({
    input: `${uid}-${field}`,
    hint: `${uid}-${field}-hint`,
    error: `${uid}-${field}-error`,
  });

  return (
    <form action={action} className="flex flex-col gap-6">
      <div
        className="flex flex-col gap-2 outline-none"
        ref={focusRef}
        tabIndex={-1}
      >
        <h2 className="text-2xl text-text sm:text-3xl" id={`${uid}-title`}>
          {t("title")}
        </h2>
        <p className="text-muted text-sm">{t("intro")}</p>
      </div>

      {hasFieldErrors ? (
        <Notice title={t("errors.title")} tone="danger">
          {t("errors.summary")}
        </Notice>
      ) : null}
      {notice ? <VerifyNotice notice={notice} /> : null}

      <Field
        error={errorText(fieldErrors.playerName)}
        hint={t("playerName.hint")}
        ids={ids("playerName")}
        label={t("playerName.label")}
      >
        {(a11y) => (
          <input
            {...a11y}
            autoComplete="nickname"
            className={inputClass}
            defaultValue={values.playerName}
            maxLength={DELETION_LIMITS.playerNameMax}
            minLength={DELETION_LIMITS.playerNameMin}
            name="playerName"
            required
            spellCheck={false}
            type="text"
          />
        )}
      </Field>

      <Field
        error={errorText(fieldErrors.code)}
        hint={t("code.hint", { minutes: codeMinutes })}
        ids={ids("code")}
        label={t("code.label")}
      >
        {(a11y) => (
          <input
            {...a11y}
            autoCapitalize="characters"
            autoComplete="one-time-code"
            className={`${inputClass} font-pixel text-xl uppercase tracking-[0.2em] placeholder:tracking-[0.2em]`}
            defaultValue={values.code}
            maxLength={DELETION_LIMITS.codeInputMax}
            name="code"
            placeholder={t("code.placeholder")}
            required
            spellCheck={false}
            type="text"
          />
        )}
      </Field>

      {/* Bot trap: off-screen and skipped by keyboard and screen readers. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px">
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

      <div>
        <button
          className="btn btn-primary w-full disabled:cursor-wait sm:w-auto"
          disabled={pending}
          name={INTENT_FIELD}
          type="submit"
          value="verify"
        >
          {pending ? t("submitting") : t("submit")}
        </button>
      </div>
    </form>
  );
}

function VerifyNotice({ notice }: { notice: DeletionNotice }) {
  const t = useTranslations("deletion.form.notices");
  const tone = notice === "cancelled" ? "calm" : "danger";
  return (
    <Notice title={t(`${notice}.title`)} tone={tone}>
      {t.rich(`${notice}.text`, {
        help: (chunks) => (
          <a
            className="text-violet-link underline hover:text-gold"
            href="#no-access"
          >
            {chunks}
          </a>
        ),
      })}
    </Notice>
  );
}

// --- step 2: show the account, delete for good ----------------------------------------------------

function ConfirmStep({
  action,
  account,
  confirmation,
  confirmMinutes,
  failed,
  pending,
  focusRef,
}: {
  action: (formData: FormData) => void;
  account: DeletionPreview;
  confirmation: string;
  confirmMinutes: number;
  failed?: "unreachable" | "rejected";
  pending: boolean;
  focusRef: RefObject<HTMLDivElement | null>;
}) {
  const t = useTranslations("deletion.confirm");
  const uid = useId();
  const guilds = previewGuilds(account);
  const guildLabels = guilds.map((guild) => `${guild.name} [${guild.tag}]`);

  return (
    <form action={action} className="flex flex-col gap-6">
      <input name={CONFIRM_FIELD} type="hidden" value={confirmation} />
      <input name="previewName" type="hidden" value={account.playerName} />
      <input name="previewRuns" type="hidden" value={account.runCount} />
      {guilds.map((guild) => (
        <Fragment key={guild.tag}>
          <input
            name={PREVIEW_GUILD_NAME_FIELD}
            type="hidden"
            value={guild.name}
          />
          <input
            name={PREVIEW_GUILD_TAG_FIELD}
            type="hidden"
            value={guild.tag}
          />
        </Fragment>
      ))}

      <div
        className="flex flex-col gap-2 outline-none"
        ref={focusRef}
        tabIndex={-1}
      >
        <h2 className="text-2xl text-text sm:text-3xl" id={`${uid}-title`}>
          {t("title")}
        </h2>
        <p className="text-muted text-sm">
          {t("intro", { minutes: confirmMinutes })}
        </p>
      </div>

      {failed ? (
        <Notice title={t(`failed.${failed}.title`)} tone="danger">
          {t(`failed.${failed}.text`)}
        </Notice>
      ) : null}

      <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 border-line border-y-2 py-4">
        <dt className="text-muted text-sm">{t("nameLabel")}</dt>
        <dd className="break-all font-pixel text-gold text-xl">
          {account.playerName}
        </dd>
        <dt className="text-muted text-sm">
          {t("guildLabel", { count: guilds.length })}
        </dt>
        <dd className="break-words text-text">
          {guildLabels.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {guildLabels.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          ) : (
            t("noGuild")
          )}
        </dd>
        <dt className="text-muted text-sm">{t("runsLabel")}</dt>
        <dd className="font-pixel text-lg text-text">{account.runCount}</dd>
      </dl>

      <div className="flex flex-col gap-3">
        <h3 className="text-lg text-text">{t("goneTitle")}</h3>
        <ul className="flex flex-col gap-2.5 text-sm text-soft">
          <GoneItem>{t("gone.account")}</GoneItem>
          <GoneItem>{t("gone.logins")}</GoneItem>
          {guildLabels.length > 0 ? (
            <GoneItem>
              {t("gone.guild", {
                count: guildLabels.length,
                guild: guildLabels[0] ?? "",
              })}
            </GoneItem>
          ) : null}
          {guildLabels.length > 0 ? (
            <GoneItem>{t("gone.founder")}</GoneItem>
          ) : null}
          <GoneItem>{t("gone.runs", { count: account.runCount })}</GoneItem>
        </ul>
      </div>

      <p className="flex items-start gap-3 font-bold text-text">
        <Sprite className="mt-0.5 shrink-0" id="icon_info" scale={2} />
        <span>{t("final")}</span>
      </p>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <button
          className="btn w-full sm:w-auto"
          disabled={pending}
          formNoValidate
          name={INTENT_FIELD}
          type="submit"
          value="cancel"
        >
          {t("cancel")}
        </button>
        <button
          className={dangerButtonClass}
          disabled={pending}
          name={INTENT_FIELD}
          type="submit"
          value="confirm"
        >
          {pending ? t("submitting") : t("submit")}
        </button>
      </div>
    </form>
  );
}

function GoneItem({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <Sprite className="mt-0.5 shrink-0" id="skull_icon" scale={1} />
      <span>{children}</span>
    </li>
  );
}

// --- done ----------------------------------------------------------------------------------------

function Deleted({
  deletedAt,
  focusRef,
}: {
  deletedAt: string;
  focusRef: RefObject<HTMLDivElement | null>;
}) {
  const t = useTranslations("deletion.done");
  const format = useFormatter();
  const at = format.dateTime(new Date(deletedAt), {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return (
    <div
      className="flex flex-col items-start gap-5 outline-none"
      ref={focusRef}
      role="status"
      tabIndex={-1}
    >
      <div className="flex items-end gap-4">
        <Sprite id="soul_flame_dying_6f" scale={2} />
        <h2 className="text-2xl text-gold sm:text-3xl">{t("title")}</h2>
      </div>
      <dl className="grid w-full grid-cols-[auto_1fr] gap-x-4 border-line border-y-2 py-3 text-sm">
        <dt className="text-muted">{t("atLabel")}</dt>
        <dd className="text-text">
          <time dateTime={deletedAt}>{at}</time>
        </dd>
      </dl>
      <p className="text-soft">{t("device")}</p>
      <a className="btn btn-sm" href="/">
        {t("home")}
      </a>
    </div>
  );
}

// --- shared ----------------------------------------------------------------------------------------

function Notice({
  title,
  tone,
  children,
}: {
  title: string;
  tone: "danger" | "calm";
  children: ReactNode;
}) {
  return (
    <PixelPanel
      className={`px-4 py-3 ${tone === "danger" ? "border-danger" : ""}`}
      variant="dark"
    >
      <div className="flex items-start gap-3">
        <Sprite className="mt-1 shrink-0" id="icon_info" scale={2} />
        <div className="flex flex-col gap-1">
          <p className="font-pixel text-lg text-text">{title}</p>
          <p className="text-sm text-soft">{children}</p>
        </div>
      </div>
    </PixelPanel>
  );
}

interface A11yProps {
  "aria-describedby": string;
  "aria-invalid": true | undefined;
  id: string;
}

function Field({
  ids,
  label,
  hint,
  error,
  children,
}: {
  ids: { input: string; hint: string; error: string };
  label: string;
  hint: string;
  error?: string;
  children: (a11y: A11yProps) => ReactElement;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="font-bold text-text" htmlFor={ids.input}>
        {label}
      </label>
      <p className="text-muted text-sm leading-snug" id={ids.hint}>
        {hint}
      </p>
      {children({
        id: ids.input,
        "aria-describedby": error ? `${ids.hint} ${ids.error}` : ids.hint,
        "aria-invalid": error ? true : undefined,
      })}
      {error ? (
        <p
          className="flex items-start gap-2 font-bold text-sm text-text"
          id={ids.error}
        >
          <Sprite className="mt-0.5 shrink-0" id="skull_icon" scale={1} />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
