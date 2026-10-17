# Security policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Report them privately through GitHub:

**[Security → Report a vulnerability](https://github.com/WebBude-de/soulwick-platform/security/advisories/new)**

If that does not work for you, write to [hello@playsoulwick.com](mailto:hello@playsoulwick.com) with
"Security" in the subject. English or German is fine.

Helpful details: the affected app (website, API, relay, admin panel) and route, steps to reproduce and
what an attacker could do with it. We are a small team and answer as soon as we can, usually within a
week. We will keep you posted, fix the issue and credit you in the advisory if you like.

## Supported versions

| Version | Supported |
| --- | --- |
| What runs on `playsoulwick.com` and its subdomains (`production` and `development`) | yes |
| `main` and `dev` | yes |
| Older commits | no |

## Scope

This repository covers the website, the player and admin API, the co-op relay, the admin panel, the
contracts, the database schema and migrations, the Dockerfiles and the deployment guide. Problems in
the game client belong to [soulwick](https://github.com/WebBude-de/soulwick/security) – but if you are
unsure, just report it here.

Examples we care about: signing in as someone else, reaching the admin API without an admin account,
reading or changing other players' accounts, guilds, runs or bug reports, faking leaderboard entries
past the server checks, reading co-op traffic through the relay, injection of any kind, leaked secrets.

**Please test against a local setup** (`bun dev`, see the [README](README.md)) whenever possible. On
the official servers: no load or denial-of-service tests, no automated scanners, and do not access or
keep data of other players beyond what is needed to show the problem. Issues in third-party services
(Cloudflare, Dokploy, Steam, Google) go to those vendors.

## Player data

The platform stores only platform IDs (Steam, device, later Google Play and Game Center), player
names, guilds and run reports; bug reports from test builds are deleted after 90 days. Secrets live in
Dokploy and in local `.env*` files that are never committed. Details:
[privacy policy](https://playsoulwick.com/privacy).
