## What and why

<!-- Short summary in English or German. Link the issue, e.g. "Closes #123". -->

## How it was tested

- [ ] `bun run check` (Biome)
- [ ] `bun run typecheck`
- [ ] `bun run test`
- [ ] `bun run build`
- [ ] Schema or migrations changed: `bun run db:verify`
- [ ] Tried it locally (what, which app, which browser):

<!-- Screenshots are welcome for anything visible on the website or in the admin panel. -->

## Checklist

- [ ] Targets `dev`; commit messages like `feat(scope): summary`
- [ ] Contract changes start in `packages/contracts` and stay backwards compatible for older game versions
- [ ] Database changes only through a new migration; existing migrations untouched
- [ ] Website texts in `apps/web/messages/en` and `apps/web/messages/de`
- [ ] Technical decisions documented in `docs/DECISIONS.md` with a P-number (product decisions: D-number in the game repo); nothing marked `OFFEN` was decided silently
- [ ] No secrets, `.env` files, tokens or personal data; new environment variables are in `.env.example`
- [ ] No new dependency without discussion; no new artwork, music or sound without prior agreement ([LICENSE-ASSETS.md](https://github.com/WebBude-de/soulwick-platform/blob/main/LICENSE-ASSETS.md))
- [ ] I agree that my contribution is licensed under GPL-3.0-or-later ([CONTRIBUTING.md](https://github.com/WebBude-de/soulwick-platform/blob/main/CONTRIBUTING.md))
