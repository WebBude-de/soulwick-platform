import type { Metadata } from "next";
import { changeOwnEmail, changeOwnPassword } from "@/app/actions";
import { Chip, DetailList, Flash, PageTitle, Section } from "@/components/ui";
import { getMe, isAdmin } from "@/lib/api";
import { ADMIN_ROLE_LABEL, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Mein Konto" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** "Mein Konto": the signed-in admin or moderator changes their own e-mail and password. */
export default async function AccountPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [params, me] = await Promise.all([searchParams, getMe()]);

  return (
    <>
      <PageTitle
        icon="lock"
        sub="Deine eigene Anmeldung im Admin-Bereich. Beide Änderungen brauchen dein aktuelles Passwort und stehen im Protokoll (das Passwort selbst nie)."
      >
        Mein Konto
      </PageTitle>
      <Flash params={params} />

      <Section title="Angemeldet als">
        <DetailList
          items={[
            {
              label: "E-Mail",
              value: (
                <span className="break-all font-semibold">{me.email}</span>
              ),
            },
            {
              label: "Rolle",
              value: (
                <Chip tone={isAdmin(me) ? "flagged" : "muted"}>
                  {ADMIN_ROLE_LABEL[me.role]}
                </Chip>
              ),
            },
            {
              label: "Angelegt",
              value: (
                <span className="font-data text-muted">
                  {formatDateTime(me.createdAt)}
                </span>
              ),
            },
          ]}
        />
      </Section>

      <div className="grid gap-x-6 xl:grid-cols-2">
        <Section title="E-Mail-Adresse ändern">
          <form action={changeOwnEmail} className="max-w-md space-y-4">
            <label className="block">
              <span className="field-label">Neue E-Mail-Adresse</span>
              <input
                autoComplete="email"
                className="input w-full"
                name="email"
                required
                type="email"
              />
            </label>
            <label className="block">
              <span className="field-label">Aktuelles Passwort</span>
              <input
                autoComplete="current-password"
                className="input w-full"
                name="currentPassword"
                required
                type="password"
              />
            </label>
            <p className="text-muted text-sm">
              Gilt sofort für die nächste Anmeldung. Es gibt keine
              Bestätigungsmail – bitte die Adresse genau prüfen.
            </p>
            <button className="btn btn-primary" type="submit">
              E-Mail ändern
            </button>
          </form>
        </Section>

        <Section title="Passwort ändern">
          <form action={changeOwnPassword} className="max-w-md space-y-4">
            <label className="block">
              <span className="field-label">Aktuelles Passwort</span>
              <input
                autoComplete="current-password"
                className="input w-full"
                name="currentPassword"
                required
                type="password"
              />
            </label>
            <label className="block">
              <span className="field-label">
                Neues Passwort (mind. 12 Zeichen)
              </span>
              <input
                autoComplete="new-password"
                className="input w-full"
                maxLength={256}
                minLength={12}
                name="newPassword"
                required
                type="password"
              />
            </label>
            <label className="block">
              <span className="field-label">Neues Passwort wiederholen</span>
              <input
                autoComplete="new-password"
                className="input w-full"
                maxLength={256}
                minLength={12}
                name="repeatPassword"
                required
                type="password"
              />
            </label>
            <p className="text-muted text-sm">
              Danach sind alle anderen Sitzungen dieses Kontos abgemeldet (z. B.
              ein anderer Browser); diese hier bleibt angemeldet.
            </p>
            <button className="btn btn-primary" type="submit">
              Passwort ändern
            </button>
          </form>
        </Section>
      </div>
    </>
  );
}
