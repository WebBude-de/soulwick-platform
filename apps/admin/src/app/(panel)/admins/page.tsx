import type { AdminUserList } from "@soulwick/contracts";
import type { Metadata } from "next";
import { createAdminUser, setAdminDisabled } from "@/app/actions";
import { RowAction, RowDangerAction } from "@/components/danger-action";
import {
  Chip,
  ErrorBox,
  Flash,
  PageTitle,
  RowActions,
  Section,
  Truncate,
  When,
} from "@/components/ui";
import { api, getMe, isAdmin } from "@/lib/api";
import { ADMIN_ROLE_LABEL, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Admins" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [params, me] = await Promise.all([searchParams, getMe()]);
  if (!isAdmin(me)) {
    return <ErrorBox message="Nur für die Rolle Admin." />;
  }
  const result = await api<AdminUserList>("/admin/admins");

  return (
    <>
      <PageTitle
        icon="admins"
        sub="Moderatoren dürfen sperren, Runs markieren und Gildenmitglieder entfernen; Admins zusätzlich Gilden auflösen, Runs und Konten löschen und Zugänge verwalten."
      >
        Admins
      </PageTitle>
      <Flash params={params} />

      <Section flush title="Zugänge">
        {result.ok ? (
          <div className="overflow-x-auto border-line border-t-2">
            <table className="table">
              <thead>
                <tr>
                  <th>E-Mail</th>
                  <th>Status</th>
                  <th>Rolle</th>
                  <th>Angelegt</th>
                  <th className="text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {result.data.items.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <span className="flex min-w-0 items-center gap-2">
                        <Truncate className="font-semibold" max="max-w-80">
                          {a.email}
                        </Truncate>
                        {a.id === me.id ? (
                          <span className="whitespace-nowrap text-muted">
                            (du)
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td>
                      {a.disabledAt ? (
                        <Chip
                          title={`seit ${formatDateTime(a.disabledAt)}`}
                          tone="danger"
                        >
                          deaktiviert
                        </Chip>
                      ) : (
                        <Chip tone="active">aktiv</Chip>
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      {ADMIN_ROLE_LABEL[a.role]}
                    </td>
                    <td>
                      <When className="text-muted" iso={a.createdAt} />
                    </td>
                    <td>
                      <RowActions>
                        {a.id === me.id ? (
                          <span className="text-muted">–</span>
                        ) : a.disabledAt ? (
                          <RowAction
                            action={setAdminDisabled.bind(
                              null,
                              a.id,
                              a.email,
                              false
                            )}
                            hint={`${a.email} wieder anmelden lassen`}
                            label="Aktivieren"
                          />
                        ) : (
                          <RowDangerAction
                            action={setAdminDisabled.bind(
                              null,
                              a.id,
                              a.email,
                              true
                            )}
                            description={
                              <p className="wrap-anywhere">
                                {a.email} kann sich danach nicht mehr anmelden.
                                Aktivieren geht jederzeit wieder.
                              </p>
                            }
                            id={`admin-disable-${a.id}`}
                            label="Deaktivieren…"
                            submitLabel="Zugang deaktivieren"
                          />
                        )}
                      </RowActions>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-4 sm:px-5">
            <ErrorBox message={result.message} />
          </div>
        )}
      </Section>

      <Section title="Neuen Zugang anlegen">
        <form
          action={createAdminUser}
          className="flex flex-wrap items-end gap-3"
        >
          <label>
            <span className="field-label">E-Mail</span>
            <input
              autoComplete="off"
              className="input w-72 max-w-full"
              name="email"
              required
              type="email"
            />
          </label>
          <label>
            <span className="field-label">Passwort (mind. 12 Zeichen)</span>
            <input
              autoComplete="new-password"
              className="input w-64 max-w-full"
              minLength={12}
              name="password"
              required
              type="password"
            />
          </label>
          <label>
            <span className="field-label">Rolle</span>
            <select className="input" defaultValue="moderator" name="role">
              <option value="moderator">Moderator</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button className="btn btn-primary" type="submit">
            Anlegen
          </button>
        </form>
      </Section>
    </>
  );
}
