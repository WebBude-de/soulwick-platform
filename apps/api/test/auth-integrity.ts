import type pg from "pg";

/**
 * P-037 check: `player_identities` and the players' rows in `auth_accounts` must match one to
 * one, and an `email` identity must point at its player's user row with a real address. Returns
 * human-readable problems (empty = consistent). Used after every flow in the KF5 tests.
 */
export async function authIntegrityIssues(
  client: pg.Client
): Promise<string[]> {
  const issues: string[] = [];
  const orphanAccounts = await client.query(`
    select a.id, a.provider_id from auth_accounts a
    join auth_users u on u.id = a.user_id
    where u.player_id is not null
      and not exists (select 1 from player_identities i where i.auth_account_id = a.id)`);
  for (const row of orphanAccounts.rows) {
    issues.push(`auth_account ${row.provider_id} without identity`);
  }
  const missingAccounts = await client.query(`
    select i.provider from player_identities i
    where i.provider in ('password', 'google', 'apple', 'discord') and i.auth_account_id is null`);
  for (const row of missingAccounts.rows) {
    issues.push(`identity ${row.provider} without auth_account`);
  }
  const foreignAccounts = await client.query(`
    select i.provider from player_identities i
    join auth_accounts a on a.id = i.auth_account_id
    join auth_users u on u.id = a.user_id
    where u.player_id is distinct from i.player_id`);
  for (const row of foreignAccounts.rows) {
    issues.push(
      `identity ${row.provider} with an auth_account of another user`
    );
  }
  const badEmails = await client.query(`
    select i.id from player_identities i
    left join auth_users u on u.id::text = i.provider_user_id
    where i.provider = 'email'
      and (u.id is null or u.player_id is distinct from i.player_id
           or u.email like '%@players.soulwick.invalid')`);
  for (const row of badEmails.rows) {
    issues.push(`email identity ${row.id} does not match its user`);
  }
  const strayEmails = await client.query(`
    select u.id from auth_users u
    where u.player_id is not null
      and u.email not like '%@players.soulwick.invalid'
      and not exists (
        select 1 from player_identities i
        where i.provider = 'email' and i.provider_user_id = u.id::text)`);
  for (const row of strayEmails.rows) {
    issues.push(`player user ${row.id} has an e-mail without identity`);
  }
  return issues;
}
