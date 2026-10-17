# Contributing to the Soulwick platform

Thanks for wanting to help! Bug reports, ideas and pull requests are all welcome. **English or German
is fine** – the project docs are in German ([docs/](docs/)), the code is in English.

## Ways to help

- **Report a bug** in the website, the API, the co-op relay or the admin panel with the
  [bug report form](https://github.com/WebBude-de/soulwick-platform/issues/new/choose). Bugs in the
  game itself belong in the [game repo](https://github.com/WebBude-de/soulwick/issues/new/choose).
- **Share an idea** for the website, leaderboards, guild pages or the online features.
- **Write code:** pick an issue (look for `good first issue` and `help wanted`) or open one first for
  bigger changes, so we can agree on the direction before you spend time on it.

## Set up

Bun 1.3, Node 24 and Docker – see [Quick start](README.md#quick-start). Never commit `.env*` files
other than `.env.example`, and never put real secrets or personal data into code, tests or seeds.

## Branches and commits

- `main` holds the stable state, `dev` is where work comes together and deploys to the test servers;
  `production` is only ever fast-forwarded from `main` ([infra/DOKPLOY.md](infra/DOKPLOY.md) §10).
- Branch off `dev`: `feature/<topic>` or `fix/<topic>`; open the pull request against `dev`.
- Every pull request needs **one review** by someone else.
- Commit messages: `type(scope): summary` in English, for example `feat(api): add guild invites` or
  `fix(web): keep the language on reload`. Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`.
- The Husky `pre-commit` hook formats staged files with Biome; `pre-push` verifies migrations when the
  schema changed.

## Conventions

- **Contracts first:** new or changed routes and relay messages start in `packages/contracts` (zod
  schema and type); every app uses only these types. Stay backwards compatible – older game versions
  keep talking to the API.
- **Database only through migrations:** change `packages/db/prisma/schema.prisma`, then
  `bun run db:migrate --name <name>`. Never edit existing migrations, no `prisma db push`.
- **Texts:** website texts go into `apps/web/messages/en` and `apps/web/messages/de`; the admin panel
  is German.
- Code and comments in English, docs in German. Formatting and lint rules come from Biome
  (Ultracite presets); exceptions only in `biome.jsonc` with a reason.
- No new dependency without a short discussion in the issue or pull request.
- Technical decisions are documented in [docs/DECISIONS.md](docs/DECISIONS.md) as P-numbers, product
  decisions in the game repo as D-numbers. Do not silently decide anything marked `OFFEN` (open).

## Before you open a pull request

```bash
bun run check        # Biome
bun run typecheck
bun run test         # needs the local Postgres: bun run services:up
bun run build
bun run db:verify    # when the schema or migrations changed
```

## Artwork, music and sound

The content of Soulwick (artwork, music, sound, logo, name, characters) is **not** open source
([LICENSE-ASSETS.md](LICENSE-ASSETS.md)). Please **do not send artwork, music or sound without
talking to us first** – open an issue and we will figure it out together.

## Working with AI assistants

AI-assisted contributions are welcome. This repository is set up for coding agents: read
[AGENTS.md](AGENTS.md) and the game repo's
[AGENTS.md](https://github.com/WebBude-de/soulwick/blob/main/AGENTS.md) (both German). You are
responsible for what you submit: understand it, test it, keep the diff focused.

## License of contributions

By submitting a contribution you agree that it is licensed under the
**GNU General Public License v3.0 or later**, the license of the code ("inbound = outbound"), and that
you have the right to contribute it. Whether we will ask for a contributor license agreement (CLA)
later is still open; we will say so here before it applies to anyone.

## Code of Conduct and security

Be kind – we follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems go through
[SECURITY.md](SECURITY.md), never a public issue.
