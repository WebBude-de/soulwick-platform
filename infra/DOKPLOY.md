# Soulwick auf Dokploy betreiben

> **Stand 15.10.2026, noch nicht auf dem Server erprobt.** Abweichungen beim ersten Einrichten bitte
> hier nachtragen. Pakete: ROADMAP **P2** (online gehen), **P16** (Variablen je Umgebung), **P17**
> (Relay auf Dokploy). Entscheidungen: P-003, P-005, P-008, P-016, P-018, P-027, P-028 in
> [DECISIONS.md](../docs/DECISIONS.md); Zielbild in [KONZEPT_ONLINE.md](../docs/KONZEPT_ONLINE.md) §4.
>
> Der Ordner `infra/` enthält nur die **lokalen** Dienste (`docker-compose.yml` mit Postgres) und diese
> Anleitung. Auf dem Server wird die Compose-Datei **nicht** benutzt: Dokploy baut jede App einzeln aus
> ihrem Dockerfile.

**Schnellster Weg heute Abend:** [§0 Checkliste](#0-checkliste-dev-instanz-aufsetzen) abarbeiten, Details
stehen in §1–§11, der Test-Build für Freunde in [§12](#12-test-build-an-einen-freund-geben).

## Auf einen Blick

Ein Dokploy-Projekt `soulwick` mit **zwei Umgebungen**. Jede Umgebung hat **fünf Services**: eine
Postgres-Datenbank und vier Applications. **Nichts wird zwischen den Umgebungen geteilt**: Dev und
Prod haben je eine eigene Datenbank, eigene Geheimnisse und einen **eigenen Relay**.

| Service | Port | `development` (Präfix `dev.`) | `production` (ohne Präfix) | Healthcheck |
| --- | --- | --- | --- | --- |
| `soulwick-postgres` | 5432 (nur intern) | – | – | – |
| `soulwick-api` | 8787 | `api-dev.playsoulwick.com` | `api.playsoulwick.com` | `GET /health` |
| `soulwick-relay` | 8790 | `play-dev.playsoulwick.com` | `play.playsoulwick.com` | `GET /health` |
| `soulwick-web` | 3000 | `dev.playsoulwick.com` | `playsoulwick.com` (+ `www.` → Weiterleitung) | `GET /` |
| `soulwick-admin` | 3001 | `admin-dev.playsoulwick.com` | `admin.playsoulwick.com` | `GET /login` |

Die Healthchecks stehen als `HEALTHCHECK` in den Dockerfiles; Dokploy zeigt den Zustand am Container.

---

## 0. Checkliste: Dev-Instanz aufsetzen

Reihenfolge einhalten; jeder Schritt verweist auf den Abschnitt mit den Details.

### A. Vorbereitung (einmalig)

- [ ] **Code auf GitHub:** Das Repo `WebBude-de/soulwick-platform` (privat) enthält den Stand. Commit und
  Push macht das Projektmitglied selbst (Agenten pushen nicht). Vorher `git status` prüfen: Es darf
  **keine** `.env.local`, `.env.dev` oder `.env.prod` dabei sein (nur `.env.example`; `.gitignore` deckt das ab).
- [ ] **Branch für `development` festlegen:** vorerst `feature/platform-foundation` (der einzige Branch
  mit Code). Später, sobald `main` existiert, auf `main` umstellen (Application → Provider → Branch).
- [ ] **Dokploy mit GitHub verbinden:** *Settings → Git → GitHub → Create GitHub App*, die App für die
  Organisation **`WebBude-de`** installieren und Zugriff auf `soulwick-platform` geben.
- [ ] **Cloudflare-Ursprungszertifikat** (§2): in Cloudflare erzeugen und in Dokploy unter
  *Settings → Certificates* hinterlegen; Cloudflare auf **Full (strict)**. Kein Let's Encrypt nötig.
- [ ] **DNS** (§2): A-Records (bei IPv6 zusätzlich AAAA) auf die VPS-IP für `dev`, `api-dev`,
  `admin-dev`, `play-dev`, **mit Cloudflare-Proxy** (orange Wolke). Nur eine Ebene unter der Domain:
  `api.dev` hätte kein Cloudflare-Zertifikat.
- [ ] **Geheimnisse erzeugen** (§3): `BETTER_AUTH_SECRET`, `RELAY_INTERNAL_KEY`, `DEV_AUTH_KEY`,
  Datenbank-Passwort, alle nur für `development`. In einem Passwort-Manager ablegen, nirgends committen.

### B. Services anlegen (noch nicht deployen)

- [ ] Projekt **`soulwick`** anlegen, darin die Umgebung **`development`** (`production` kommt später, §13).
- [ ] **Datenbank** (§5): *Create Service → Database → PostgreSQL 17*, Name `soulwick-postgres`,
  App Name `soulwick-postgres-dev`, Datenbank `soulwick`, Benutzer `soulwick`, Passwort aus A. **Kein**
  externer Port. Deployen und die **Internal Connection URL** kopieren.
- [ ] **Vier Applications** (§6) anlegen: `soulwick-api`, `soulwick-relay`, `soulwick-web`,
  `soulwick-admin`, je mit App Name `soulwick-<app>-dev`. Bei jeder:
  - Provider **GitHub**, Repository `WebBude-de/soulwick-platform`, Branch aus A.
  - Build Type **Dockerfile**, Dockerfile Path `apps/<app>/Dockerfile`, **Docker Context Path `.`**.
  - Replicas **1**.
- [ ] Die tatsächlichen **App Names** notieren (General-Tab; Dokploy hängt manchmal eine Zufallsendung an).
  Sie sind die internen Hostnamen für `API_INTERNAL_URL` und `RELAY_INTERNAL_URL`.

### C. Variablen und Domains

- [ ] **Umgebungs-Variablen** von `development` setzen (§4, Block „`development`“), mit den echten App
  Names in `API_INTERNAL_URL` und `RELAY_INTERNAL_URL` und `RELAY_PUBLIC_URL=wss://play-dev.playsoulwick.com`.
- [ ] **Service-Variablen** je Application aus §4 einfügen (`soulwick-api`, `soulwick-relay`,
  `soulwick-web`, `soulwick-admin`); darin u. a. `GUEST_AUTH_ENABLED=true` bei der API.
- [ ] **Domains** je Application (§6): Host aus der Tabelle oben, Path `/`, Container Port
  `8787` / `8790` / `3000` / `3001`, HTTPS an, Certificate Provider **None** (Traefik nimmt das
  Ursprungszertifikat aus §2, weil es zum Host passt).

### D. Deployen und prüfen

- [ ] **API deployen.** Der Container spielt beim Start die Migrationen ein (`prisma migrate deploy`) und
  startet dann die API (§6). Logs in Dokploy ansehen, bis eine Zeile mit `"msg":"listening"` erscheint.
- [ ] **API prüfen:**

  ```bash
  curl https://api-dev.playsoulwick.com/health
  # {"status":"ok","apiVersion":…,"db":"ok","time":…,"minGameVersion":null,"protocolVersion":1}
  curl https://api-dev.playsoulwick.com/public/config
  # … "relayUrl":"wss://play-dev.playsoulwick.com/v1", … "guestAuth":true
  ```

  `relayUrl` muss auf den Dev-Relay zeigen (mit `/v1`), `guestAuth` muss `true` sein.
- [ ] **Ersten Admin anlegen** (§7) im Terminal des API-Containers:
  `bun apps/api/src/scripts/create-admin.ts <deine-email> "<langes-passwort>" admin`.
- [ ] Optional: **Demo-Daten** für die Dev-Website (§7).
- [ ] **Relay deployen** und prüfen: `curl https://play-dev.playsoulwick.com/health` liefert `"status":"ok"`.
- [ ] **WebSocket-Test** (§6, „Relay testen“): `bunx wscat -c wss://play-dev.playsoulwick.com/v1` verbindet
  sich und wird nach 5 s ohne `hello` geschlossen; mit Gast-Token antwortet der Relay `welcome` und auf
  `create` mit einem Raumcode.
- [ ] **Web und Admin deployen.** `https://dev.playsoulwick.com` zeigt die Startseite,
  `https://admin-dev.playsoulwick.com` die Anmeldung; mit dem Admin aus D einloggen, „Live-Räume“ öffnen
  (darf nicht „Relay nicht konfiguriert“ melden).
- [ ] **Admin-Bereich schützen** (§8), am einfachsten Basic Auth. Vor dem Teilen der Adressen erledigen.

### E. Mit einem Freund spielen

- [ ] Test-Build exportieren und weitergeben (§12).
- [ ] Beide starten den Build: Hauptmenü unten rechts „v0.9.0 dev“ und „Online bereit“.
- [ ] Raum im Gildengebäude erstellen, Raumcode schicken, beitreten, Run starten.
- [ ] Danach: Admin-Panel → „Live-Räume“ bzw. Relay-`/metrics` ansehen (Bytes/s, §11).

---

## 1. Überblick

- **`development`** baut vorerst aus `feature/platform-foundation`, später aus `main` (Auto Deploy).
  Spielwiese für Test-Builds des Spiels (Freunde-Builds, später Steam-Beta-Branch und Play „Interner
  Test“) und für die Admin-Schulung.
- **`production`** baut aus dem Branch `production`. Auf diesen Branch wird **nie direkt committet**, er
  wird nur vorgespult: `git push origin main:production` (§10).
- Innerhalb einer Umgebung teilen API und Relay nur `RELAY_INTERNAL_KEY`. Der Relay prüft Spieler-JWTs
  mit den öffentlichen Schlüsseln der API (`/auth/jwks`) und kennt kein Geheimnis der API (P-027).

### Welche Umgebung nutzt das Spiel?

Das Spiel wählt Dev oder Prod **beim Export**, nicht im laufenden Spiel (P-018; Code im Spiel-Repo,
derzeit im Worktree `soulwick-mp`: `online/online_config.gd`, `online/environment.cfg`):

1. **Editor:** Der Godot-Editor (und jeder Start mit der Editor-EXE) nutzt immer `local` =
   `http://localhost:8787` und `ws://localhost:8790/v1`, also `bun dev` aus diesem Repo.
2. **Exportierter Build:** Die Umgebung kommt aus dem Feature-Tag `env_development` bzw.
   `env_production` der Export-Vorlage, sonst aus `online/environment.cfg` (`[build] env="development"`
   oder `"production"`), sonst `development`. Das Skript `tools/export_build.ps1 -Env …` schreibt die
   Datei für den Export und stellt sie danach wieder her.
3. **API-URL je Umgebung** steht im Spiel: `https://api-dev.playsoulwick.com` bzw.
   `https://api.playsoulwick.com`.
4. **Relay-URL ist nicht fest:** Das Spiel fragt `GET /public/config` der API und nimmt `relayUrl`
   (aus `RELAY_PUBLIC_URL`). Nur wenn die API keinen Relay meldet, gilt der Standard der Umgebung
   (`wss://play-dev.playsoulwick.com/v1` bzw. `wss://play.playsoulwick.com/v1`). Ein Relay-Umzug
   braucht also nur eine geänderte Variable, keinen neuen Build.
5. Zum Testen lässt sich alles überschreiben: Kommandozeile `-- env=development`, `-- api=…`,
   `-- relay=…` oder `user://online.cfg`.
6. Das **Hauptmenü** zeigt unten rechts Version und Umgebung: „v0.9.0 dev“ in `development`, in
   `production` nur die Version; darunter „Online bereit“ oder den Offline-Hinweis.

### Cookies der Dev- und Prod-Hosts

Das Admin-Panel setzt sein Sitzungs-Cookie `soulwick_admin` ohne `Domain`-Attribut (Host-only); der
Browser schickt es nur an genau den Host, der es gesetzt hat, also nie von `admin-dev` an `admin`.
Seit die Dev-Hosts flach unter der Domain liegen (`api-dev`, `admin-dev`, `play-dev`, P-029), teilen
Dev und Prod dieselbe Elternebene: **Cookies nie mit `Domain=.playsoulwick.com` setzen**, sonst gingen
sie an beide Umgebungen.

## 2. DNS und TLS (Cloudflare, P-029)

Die Domain liegt bei Cloudflare. A-Records (bei IPv6 zusätzlich AAAA) auf die VPS-IP, **alle mit
Proxy** (orange Wolke):

| Umgebung | Einträge |
| --- | --- |
| `development` | `dev`, `api-dev`, `admin-dev`, `play-dev` |
| `production` | `@` (`playsoulwick.com`), `api`, `admin`, `play` |
| Weiterleitung | `www` als Platzhalter (z. B. A `192.0.2.1` oder AAAA `100::`, mit Proxy) plus Redirect Rule |

**Nur eine Ebene unter der Domain:** Das kostenlose Cloudflare-Zertifikat gilt für `playsoulwick.com`
und `*.playsoulwick.com`, nicht für `*.dev.playsoulwick.com`. Deshalb `api-dev` statt `api.dev`.

**TLS:**

1. Cloudflare → *SSL/TLS → Übersicht*: **Full (strict)**.
2. Cloudflare → *SSL/TLS → Ursprungsserver → Zertifikat erstellen*: RSA 2048, Hostnamen
   `playsoulwick.com` und `*.playsoulwick.com`, 15 Jahre. Zertifikat und privaten Schlüssel sichern
   (der Schlüssel wird nur einmal angezeigt, Passwort-Manager).
3. Dokploy → *Settings → Certificates → Add Certificate*: Zertifikat und Schlüssel einfügen.
4. Domains in Dokploy: HTTPS an, Certificate Provider **None**; Traefik nimmt das passende
   Ursprungszertifikat. Kein Let's Encrypt (hinter dem Proxy scheitert dessen HTTP-Prüfung, sobald
   Cloudflare HTTP auf HTTPS umleitet).
5. Cloudflare → *SSL/TLS → Edge-Zertifikate*: **Always Use HTTPS** an.
6. Cloudflare → *Regeln → Redirect Rules*: Hostname gleich `www.playsoulwick.com` → dynamisch
   `concat("https://playsoulwick.com", http.request.uri.path)`, 301, Query-String beibehalten.
   In Dokploy dann **keine** `www`-Domain.

**Was der Proxy für API und Relay bedeutet:**

- **Client-IP:** API und Relay lesen hinter dem Proxy zuerst `CF-Connecting-IP`, dann
  `X-Forwarded-For` (`TRUST_PROXY=true`). Ohne das teilten sich alle Spieler das Limit eines
  Cloudflare-Knotens.
- **WebSocket:** Cloudflare leitet WebSockets weiter (*Netzwerk → WebSockets* an, Standard). Eine
  Verbindung ohne Daten trennt Cloudflare nach 100 s; der Relay sendet alle 15 s einen Herzschlag,
  das hält sie offen. Cloudflare kann Verbindungen bei eigenen Wartungen trennen; das Spiel verbindet
  dann neu.
- **Direkter Zugriff:** Wer die VPS-IP kennt, kann Cloudflare umgehen und `CF-Connecting-IP` selbst
  setzen. Für die Testphase in Ordnung; später die Ports 80/443 per Firewall nur für die
  Cloudflare-Adressbereiche öffnen.

## 3. Geheimnisse

**Je Umgebung eigene**, nirgends committen (Git Bash oder Linux-Shell):

```bash
openssl rand -base64 48   # BETTER_AUTH_SECRET  (nur API, ≥ 32 Zeichen, P-027)
openssl rand -hex 32      # RELAY_INTERNAL_KEY  (API und Relay, ≥ 32 Zeichen)
openssl rand -base64 24   # DEV_AUTH_KEY        (Werkzeuge und Tests, ≥ 16 Zeichen)
openssl rand -hex 24      # Passwort der Datenbank (hex: keine Sonderzeichen in der URL)
```

Ohne `openssl` geht es mit Bun:
`bun -e "console.log(require('node:crypto').randomBytes(48).toString('base64'))"`.

**Wechsel eines Geheimnisses** wirkt sofort: Ein neues `BETTER_AUTH_SECRET` meldet alle Spieler und
Admins ab, macht die gespeicherten Signierschlüssel der Relay-JWTs unlesbar (die API legt beim nächsten
`GET /auth/token` neue an; vorher am besten die Zeilen in `auth_jwks` löschen), macht offene
Verknüpfungs- und Löschcodes ungültig und ändert die Pseudonyme im Löschprotokoll (Suche „wurde Konto X
gelöscht?“ findet ältere Einträge dann nicht mehr; P-026, P-027). `RELAY_INTERNAL_KEY` immer bei API
**und** Relay gleichzeitig ändern. `TOKEN_SECRET` und `ADMIN_TOKEN_SECRET` gibt es seit P-027 nicht
mehr; vorhandene Einträge in Dokploy dürfen weg.

## 4. Variablen

### Wo was hingehört

| Vorlage | Lokal | Dokploy (Kopie liegt lokal, gitignored) |
| --- | --- | --- |
| `.env.example` (Wurzel) | `.env.local` (gemeinsame Werte) | Variablen der Umgebung: `.env.dev` → `development`, `.env.prod` → `production` |
| `apps/api/.env.example` | `apps/api/.env.local` | `soulwick-api` → **Environment**: `apps/api/.env.dev` bzw. `.env.prod` |
| `apps/relay/.env.example` | `apps/relay/.env.local` | `soulwick-relay` → **Environment**: `apps/relay/.env.dev` bzw. `.env.prod` |
| `apps/web/.env.example` | `apps/web/.env.local` | `soulwick-web` → **Environment**: `apps/web/.env.dev` bzw. `.env.prod` |
| `apps/admin/.env.example` | `apps/admin/.env.local` | `soulwick-admin` → **Environment**: `apps/admin/.env.dev` bzw. `.env.prod` |
| `infra/.env.example` | `infra/.env.local` (`POSTGRES_*`, `DB_PORT`) | – (auf den Servern nicht genutzt; Produktion: Datenbankserver) |

Die Dateien `.env.dev` und `.env.prod` sind deine lokale Kopie dessen, was in Dokploy steht: Wurzel =
Variablen der Umgebung, `apps/<app>/` = Environment des Services mit `${{environment.NAME}}`. Ändert
sich etwas in Dokploy, die Kopie mitziehen (und umgekehrt).

- Alle Variablen sind **Laufzeit-Variablen**, keine Build-Args: Web und Admin lesen `API_URL` nur
  serverseitig, nichts davon landet im Browser-Bundle. Geänderte Variablen wirken erst nach einem neuen
  **Deploy** des Services.
- `NODE_ENV` **nicht** setzen: Die Images setzen `production` selbst, auch in der Umgebung `development`.
- Gemeinsame Werte stehen einmal in den **Variablen der Umgebung**; jeder Service holt sie ausdrücklich
  mit `${{environment.NAME}}` (Dokploy reicht sie nicht automatisch durch). Kennt deine Dokploy-Version
  keine Umgebungs-Variablen, die Werte direkt in die Services schreiben (oder Projekt-Variablen mit
  `${{project.NAME}}` nutzen).

### Interne Adressen

Alle Services eines Servers hängen im Docker-Netz `dokploy-network`. Der Hostname eines Services ist
sein **App Name** in Dokploy. Weil beide Umgebungen auf demselben Server laufen, müssen die App Names
verschieden sein:

| Service | App Name `development` | App Name `production` |
| --- | --- | --- |
| `soulwick-postgres` | `soulwick-postgres-dev` | `soulwick-postgres-prod` |
| `soulwick-api` | `soulwick-api-dev` | `soulwick-api-prod` |
| `soulwick-relay` | `soulwick-relay-dev` | `soulwick-relay-prod` |
| `soulwick-web` | `soulwick-web-dev` | `soulwick-web-prod` |
| `soulwick-admin` | `soulwick-admin-dev` | `soulwick-admin-prod` |

Hängt Dokploy eine Zufallsendung an, diese Namen in `API_INTERNAL_URL`, `RELAY_INTERNAL_URL` und
`DATABASE_URL` übernehmen. Weil das Netz für beide Umgebungen dasselbe ist, schützt nur
`RELAY_INTERNAL_KEY` den internen Endpunkt der API vor dem Relay der jeweils anderen Umgebung; deshalb
je Umgebung ein eigener.

### Variablen der Umgebung `development`

```dotenv
WEB_URL=https://dev.playsoulwick.com
ADMIN_URL=https://admin-dev.playsoulwick.com
API_PUBLIC_URL=https://api-dev.playsoulwick.com
RELAY_PUBLIC_URL=wss://play-dev.playsoulwick.com
API_INTERNAL_URL=http://soulwick-api-dev:8787
RELAY_INTERNAL_URL=http://soulwick-relay-dev:8790
DATABASE_URL=<Internal Connection URL von soulwick-postgres-dev>
BETTER_AUTH_SECRET=<geheim>
RELAY_INTERNAL_KEY=<geheim>
DEV_AUTH_KEY=<geheim>
PROTOCOL_VERSION=1
MIN_GAME_VERSION=
SUPPORT_EMAIL=
```

### Variablen der Umgebung `production`

```dotenv
WEB_URL=https://playsoulwick.com
ADMIN_URL=https://admin.playsoulwick.com
API_PUBLIC_URL=https://api.playsoulwick.com
RELAY_PUBLIC_URL=wss://play.playsoulwick.com
API_INTERNAL_URL=http://soulwick-api-prod:8787
RELAY_INTERNAL_URL=http://soulwick-relay-prod:8790
DATABASE_URL=<Internal Connection URL von soulwick-postgres-prod>
BETTER_AUTH_SECRET=<geheim, anders als development>
RELAY_INTERNAL_KEY=<geheim, anders als development>
DEV_AUTH_KEY=<geheim, anders als development>
PROTOCOL_VERSION=1
MIN_GAME_VERSION=
SUPPORT_EMAIL=<Support-Adresse, PFLICHT in production (Google Play verlangt einen Löschweg ohne App)>
```

- `RELAY_PUBLIC_URL` ohne Pfad: Die API hängt `/v1` an und meldet `wss://play-dev.playsoulwick.com/v1`
  in `GET /public/config`.
- `PROTOCOL_VERSION` muss der Konstante im Spiel-Build entsprechen (`OnlineConfig.PROTOCOL_VERSION`,
  derzeit 1); sie steht nur einmal hier, damit API und Relay nie auseinanderlaufen.
- `MIN_GAME_VERSION` bleibt leer, bis die erste Spielversion veröffentlicht ist (dann z. B. `1.0.0`;
  ältere Spiele sperren ihre Online-Funktionen).

### `soulwick-api` → Environment

```dotenv
DATABASE_URL=${{environment.DATABASE_URL}}
# Better Auth (P-027): Sessions, JWT-Signierschlüssel, HMAC der Codes. BETTER_AUTH_URL = öffentliche
# Adresse der API (Aussteller der Relay-JWTs), mit NODE_ENV=production muss sie https sein.
BETTER_AUTH_SECRET=${{environment.BETTER_AUTH_SECRET}}
BETTER_AUTH_URL=${{environment.API_PUBLIC_URL}}
PLAYER_TOKEN_TTL_DAYS=30
ADMIN_TOKEN_TTL_HOURS=8

# Login POST /auth/dev mit Header x-dev-auth-key (Werkzeuge, Tests). Zum Steam-Start in production false.
DEV_AUTH_ENABLED=true
DEV_AUTH_KEY=${{environment.DEV_AUTH_KEY}}

# Gast-Anmeldung je Gerät POST /auth/device (P-028), ohne Schlüssel: so melden sich Test-Builds ohne
# Dev-Schlüssel an. Auch in production an. Rate-Limits je IP (TESTWERTE).
GUEST_AUTH_ENABLED=true
GUEST_LOGINS_PER_MINUTE=10
GUEST_ACCOUNTS_PER_HOUR=20

# Steam (P14): ohne beide Werte antwortet /auth/steam mit 501 provider_not_configured.
STEAM_WEB_API_KEY=
STEAM_APP_ID=
STEAM_TICKET_IDENTITY=soulwick
# Google Play Games (P14): Web-OAuth-Client "Game server"; ohne beide Werte 501.
GOOGLE_PLAY_CLIENT_ID=
GOOGLE_PLAY_CLIENT_SECRET=
EXTERNAL_AUTH_TIMEOUT_MS=8000

CORS_ORIGINS=${{environment.WEB_URL}},${{environment.ADMIN_URL}}
TRUST_PROXY=true
# Rate-Limits (TESTWERTE)
RATE_LIMIT_PER_MINUTE=120
LINK_ATTEMPTS_PER_MINUTE=10
DELETION_REQUESTS_PER_HOUR=5

# Plausibilität der Run-Berichte (TESTWERT); leere Versionsliste = keine Prüfung.
MIN_SECONDS_PER_ROOM=8
KNOWN_GAME_VERSIONS=

# Versionen und Relay (P16)
MIN_GAME_VERSION=${{environment.MIN_GAME_VERSION}}
PROTOCOL_VERSION=${{environment.PROTOCOL_VERSION}}
RELAY_PUBLIC_URL=${{environment.RELAY_PUBLIC_URL}}
RELAY_INTERNAL_KEY=${{environment.RELAY_INTERNAL_KEY}}
# Admin-Panel → Live-Räume, Kick, Sperre am Relay (P18); leer = 501 relay_not_configured.
RELAY_INTERNAL_URL=${{environment.RELAY_INTERNAL_URL}}
RELAY_INTERNAL_TIMEOUT_MS=3000

# Rechtstexte (P-025): beide Schlüssel nötig; fehlt einer, zeigt die Website den Platzhalter.
ERECHT24_API_KEY=
ERECHT24_PLUGIN_KEY=

# Kontolöschung ohne Spielzugang (P-026): Adresse, die die Lösch-Seite der Website zeigt; leer = keine.
SUPPORT_EMAIL=${{environment.SUPPORT_EMAIL}}

LOG_LEVEL=info
```

- **Steam:** `STEAM_WEB_API_KEY` ist der Publisher-Schlüssel (Steamworks → Users & Permissions → Manage
  Groups), nie ein Benutzer-Schlüssel; `STEAM_APP_ID` ist die eigene AppID (MP10).
- **Google Play:** Client-ID und -Secret aus Play Console → Play Games Services → Konfiguration →
  Anmeldedaten (Typ „Game server“).
- **eRecht24 (P-025):** `ERECHT24_API_KEY` ist der Projekt-Schlüssel aus dem eRecht24-Projekt-Manager,
  `ERECHT24_PLUGIN_KEY` der Plugin-Schlüssel; beide liegen nur hier (nie im Web-Build). Die API hält die
  Texte 24 h im Speicher; eine geänderte Fassung erscheint spätestens nach 24 h, sofort nach einem
  Neustart von `soulwick-api`.
- **Support-Adresse (P-026):** Die API liefert `SUPPORT_EMAIL` über `GET /public/config` als
  `supportEmail`; die Website zeigt sie auf `/delete-account` für Spieler ohne Zugang zum Spiel.
- **`DEFAULT_ADMIN_PASSWORD`** gehört **nicht** in die Variablen (nur Dev-Seed, §7).
- `PORT` setzt das Image selbst (8787).

### `soulwick-relay` → Environment

```dotenv
PROTOCOL_VERSION=${{environment.PROTOCOL_VERSION}}
# Interne Docker-Adresse der API derselben Umgebung (nicht die öffentliche Domain). Pflicht: der Relay
# holt dort die öffentlichen Schlüssel der Spieler-JWTs (/auth/jwks, P-027) und den Sperr-/Gildenstatus.
API_INTERNAL_URL=${{environment.API_INTERNAL_URL}}
RELAY_INTERNAL_KEY=${{environment.RELAY_INTERNAL_KEY}}
TRUST_PROXY=true
LOG_LEVEL=info
# Standardwerte (TESTWERTE) gelten ohne Eintrag; nur bei Bedarf setzen, siehe apps/relay/.env.example:
# JWKS_CACHE_SECONDS=600
# STATUS_CACHE_SECONDS=30
# CLIENT_ROUTING=host_only
# MAX_FRAME_BYTES=65536
# MAX_MESSAGES_PER_SECOND=1000
# MAX_BYTES_PER_SECOND=1048576
# MAX_CONNECTIONS_PER_IP_PER_MINUTE=30
# ROOM_IDLE_MINUTES=10
# HEARTBEAT_INTERVAL_SECONDS=15
# HEARTBEAT_TIMEOUT_SECONDS=30
```

`RELAY_PORT` (8790) und `RELAY_HOST` (`0.0.0.0`) setzt das Image selbst. Die Optionen für schlechtes Netz
(`RELAY_SIM_LATENCY_MS`, `RELAY_SIM_LOSS`) wirken mit `NODE_ENV=production` nicht und gehören nicht auf
den Server. Ist die API nicht erreichbar, funktionieren Schnelle Spiele mit bekanntem Schlüsselsatz weiter,
Gildenräume antworten mit `api_unavailable`.

### `soulwick-web` → Environment

```dotenv
API_URL=${{environment.API_INTERNAL_URL}}
SITE_URL=${{environment.WEB_URL}}
# Online-Teile (Ranglisten, Gildenseiten, Ranglisten-Teaser), je Umgebung verschieden:
#   development: LIVE_FEATURES=true
#   production:  LIVE_FEATURES=false   (Teaser, solange der Online-Teil nicht live ist)
LIVE_FEATURES=<true|false>
```

- **`LIVE_FEATURES`** (Stand 15.10.2026): in `development` `true` (oder weglassen, Standard ist `true`),
  in `production` **`false`**, solange der Online-Teil nicht live ist. Mit `false` ist die Website ein
  reiner Teaser: `/leaderboards` und `/guilds/<TAG>` antworten mit 404, Ranglisten-Teaser, Header-Knopf
  und Navigationslinks dazu verschwinden, die Sitemap listet die Ranglisten nicht, und die Website ruft
  keine Ranglisten-API auf. Konto-Löschung (`/delete-account`), Impressum und Datenschutz bleiben. Die
  Variable wird zur Laufzeit gelesen (kein `NEXT_PUBLIC_`): Umschalten = Wert ändern und den Service neu
  starten, kein Neubau. Jeder andere Wert als leer, `true`, `1`, `on`, `yes` gilt als aus.
- **Produktion vorerst:** Für den Teaser braucht `production` nur `soulwick-web`, `soulwick-api` und
  `soulwick-postgres` (die API liefert Rechtstexte und `SUPPORT_EMAIL` für `/delete-account`).
  `soulwick-relay` und `soulwick-admin` werden in `production` erst mit dem Online-Teil angelegt.
- Liefert die API keinen Rechtstext (eRecht24-Schlüssel fehlen, API nicht erreichbar), zeigt die Website
  `apps/web/content/legal/<imprint|privacy>.<de|en>.html`, falls vorhanden, sonst einen Platzhalter mit
  Kurzüberblick und der Support-Adresse ([apps/web/content/legal/README.md](../apps/web/content/legal/README.md)).

### `soulwick-admin` → Environment

```dotenv
API_URL=${{environment.API_INTERNAL_URL}}
ADMIN_COOKIE_SECURE=true
```

`ADMIN_COOKIE_SECURE=false` nur, wenn ein Produktions-Build über reines HTTP läuft (nie auf dem Server).

## 5. Datenbank `soulwick-postgres`

1. Je Umgebung **Create Service → Database → PostgreSQL**, Version 17, Name `soulwick-postgres`, App Name
   aus §4, Datenbank `soulwick`, Benutzer `soulwick`, Passwort aus §3.
2. **Keinen** externen Port freigeben: Die API erreicht die Datenbank über das interne Netz.
3. Die **Internal Connection URL** kopieren; sie wird `DATABASE_URL` der Umgebung.

Objektspeicher (S3) braucht Soulwick derzeit nicht; erst wenn die API Dateien speichert (z. B.
Gilden-Wappen), kommt ein Bucket dazu.

### Backups

- In Dokploy unter **Settings → Destinations** ein S3-kompatibles Ziel anlegen (z. B. Hetzner Object
  Storage, Backblaze B2).
- Bei `soulwick-postgres` (mindestens in `production`) unter **Backups** ein tägliches Backup einrichten
  (z. B. `0 3 * * *`) und eine Aufbewahrung setzen (z. B. 14 Stück).
- Die Wiederherstellung einmal in `development` testen. Manuell geht es im Terminal des
  Datenbank-Containers:

  ```bash
  pg_dump -U soulwick -d soulwick -Fc > soulwick-$(date +%F).dump
  pg_restore -U soulwick -d soulwick --clean soulwick-JJJJ-MM-TT.dump
  ```

- Vor jedem Release mit neuer Migration in `production` ein manuelles Backup auslösen.

## 6. Applications

Je Umgebung vier Applications mit denselben Einstellungen; nur Branch, Domains und Variablen
unterscheiden sich.

| Einstellung | Wert |
| --- | --- |
| Provider | GitHub (App der Organisation `WebBude-de`), Repository `soulwick-platform` |
| Branch | `development`: vorerst `feature/platform-foundation`, später `main`; `production`: `production` |
| Build Type | Dockerfile |
| Dockerfile Path | `apps/api/Dockerfile`, `apps/relay/Dockerfile`, `apps/web/Dockerfile`, `apps/admin/Dockerfile` |
| Docker Context Path | **`.`** (Repo-Wurzel). Ohne Angabe nimmt Dokploy den Ordner des Dockerfiles, dann fehlen `bun.lock`, die Workspace-Dateien und `packages/*`. Jede App hat eine eigene `apps/<app>/Dockerfile.dockerignore`. |
| Container Port (Domain) | API `8787`, Relay `8790`, Web `3000`, Admin `3001`; HTTPS an, Certificate Provider None (Cloudflare-Ursprungszertifikat, §2) |
| Replicas | **genau 1** (API und Relay zwingend, Gründe unten) |
| Auto Deploy | an, mit Watch Paths (unten) |

**Watch Paths**, damit nur betroffene Apps neu bauen:

| Service | Watch Paths |
| --- | --- |
| api | `apps/api/**`, `packages/contracts/**`, `packages/db/**`, `packages/config/**`, Root-Dateien |
| relay | `apps/relay/**`, `packages/contracts/**`, Root-Dateien |
| web | `apps/web/**`, `packages/contracts/**`, Root-Dateien |
| admin | `apps/admin/**`, `packages/contracts/**`, Root-Dateien |

Root-Dateien (in jedem Dockerfile kopiert, für `bun install --frozen-lockfile`): `package.json`,
`bun.lock`, `bunfig.toml`, `apps/*/package.json`, `packages/*/package.json`.

In `production` zusätzlich die Domain `www.playsoulwick.com` mit Weiterleitung auf `playsoulwick.com`.
Alle Container laufen ohne root (`bun` bzw. `node`). Image-Größen zuletzt lokal: API ca. 390 MB,
Admin ca. 412 MB, Relay ca. 326 MB.

### `soulwick-api`

- Image `oven/bun:1.3.14`, Start aus der Quelle (`bun apps/api/src/index.ts`).
- **Migrationen beim Start:** Der Container führt `cd packages/db && bunx prisma migrate deploy` aus
  (`packages/db/prisma/migrations`) und startet danach die API (P-003). Einen eigenen Migrationsschritt
  in Dokploy braucht es nicht. Schlägt die Migration fehl, startet der Container nicht (Logs ansehen);
  der alte Container läuft weiter.
- **Genau 1 Replica:** Rate-Limits zählen im Speicher des Prozesses, und zwei gleichzeitig startende
  Container würden gleichzeitig migrieren.
- Prüfen: `/health` liefert `{"status":"ok","apiVersion":…,"db":"ok","time":…,"minGameVersion":…,"protocolVersion":…}`
  (503 bei Datenbankfehler); `GET /public/config` meldet zusätzlich `relayUrl`, `supportEmail` und
  `guestAuth`.

### `soulwick-relay`

- Image `oven/bun:1.3.14`, Port 8790, keine Datenbank. WebSocket-Pfad `/v1`, dazu `GET /health` und
  `GET /metrics` (nur mit Header `x-relay-key`).
- **Genau 1 Replica:** Räume liegen nur im Speicher. Ein Neustart (auch jedes Deploy) schließt alle
  Räume; für die Spieler wirkt das wie ein Host-Abbruch, der Einzelspieler bleibt spielbar. Deploys des
  Relays deshalb nicht während einer Spielrunde.
- Beim Stoppen schließt der Relay offene Räume mit `shutdown` (SIGTERM), `/health` antwortet dabei 503.
- **WebSocket über Traefik:** Traefik reicht den Upgrade ohne Zusatz-Labels durch; die normale Domain mit
  HTTPS genügt. Der Relay schickt alle 15 s einen Ping, die Verbindung ist also nie lange still. Bricht
  eine Verbindung trotzdem nach festen Zeiten ab (z. B. genau 60 s oder 180 s), die `respondingTimeouts`
  (`readTimeout`, `idleTimeout`) des `websecure`-Entrypoints in der Traefik-Konfiguration von Dokploy
  (`/etc/dokploy/traefik/traefik.yml`, auch in der Oberfläche unter den Traefik-Einstellungen) erhöhen
  oder `readTimeout` auf `0` setzen und Traefik neu laden.

#### Relay testen

Aus Git Bash oder Linux (`<…>` ersetzen):

```bash
curl https://play-dev.playsoulwick.com/health
curl -H "x-relay-key: <RELAY_INTERNAL_KEY>" https://play-dev.playsoulwick.com/metrics
bunx wscat -c wss://play-dev.playsoulwick.com/v1
```

Ohne `hello` schließt der Relay die Verbindung nach 5 s; das zeigt schon, dass Upgrade und Weiterleitung
klappen. Vollständiger Test mit einem Gastkonto (legt in `development` ein Testkonto an):

```bash
API=https://api-dev.playsoulwick.com
DEVICE=$(bun -e "console.log(crypto.randomUUID())")
curl -s -X POST $API/auth/device -H "content-type: application/json" \
  -d "{\"deviceId\":\"$DEVICE\",\"name\":\"Relaytest\"}"
# → {"token":"<SESSION>",…}
curl -s -H "Authorization: Bearer <SESSION>" $API/auth/token
# → {"token":"<JWT>","expiresAt":…}   (15 min gültig)
bunx wscat -c wss://play-dev.playsoulwick.com/v1
# innerhalb von 5 s einfügen:
{"type":"hello","token":"<JWT>","protocolVersion":1,"gameVersion":"0.9.0","platform":"windows"}
# → {"type":"welcome",…}
{"type":"create","mode":"quick"}
# → {"type":"created","code":"…","peerId":1,…}
```

Format der Nachrichten: `packages/contracts/src/lobby.ts`. Für den Langzeittest mindestens 5 Minuten
verbunden bleiben. Abnahme P17: zwei Spiel-Instanzen teilen über `wss://play-dev.playsoulwick.com` einen
Raum.

### `soulwick-web` und `soulwick-admin`

- Next.js standalone auf `node:24-slim`; Bun nur im Build-Stage für `bun install`. Der Build braucht
  weder die API noch eRecht24; Seiten mit API-Daten rendern bei Aufruf.
- Beide rufen die API **serverseitig** über die interne Adresse (`API_URL` = `API_INTERNAL_URL`) auf,
  nie aus dem Browser.

## 7. Erste Inbetriebnahme: Admin und Demo-Daten

Reihenfolge je Umgebung: Datenbank → API (Migrationen) → Admin anlegen → Relay → Web und Admin
(siehe §0 D).

**Terminal des API-Containers:** in Dokploy bei `soulwick-api` → **Docker** → **Terminal** (bzw.
Schaltfläche *Terminal*), Shell `sh`, Arbeitsordner `/app`. Alternativ per SSH auf dem VPS:
`docker ps | grep soulwick-api`, dann `docker exec -it <container-id> sh`.

**Ersten Admin anlegen:**

```bash
bun apps/api/src/scripts/create-admin.ts admin@playsoulwick.com "<langes-passwort-min-12-zeichen>" admin
```

Weitere Zugänge (Moderatoren) danach im Admin-Panel unter **Admins** anlegen. Der Befehl setzt bei einer
vorhandenen E-Mail das Passwort zurück und aktiviert den Zugang wieder.

**Nur in `development`, optional:** Demo-Daten (Testspieler, Gilde „Dochtwächter“, Runs, Sperre,
Einträge im Löschprotokoll), damit Website und Admin-Panel etwas zeigen:

```bash
NODE_ENV=development DEFAULT_ADMIN_PASSWORD="<eigenes-langes-passwort>" bun apps/api/src/scripts/seed-dev.ts
```

Das legt zusätzlich `admin@soulwick.local` und `moderator@soulwick.local` an. Auf einem öffentlichen Server
**immer** ein eigenes `DEFAULT_ADMIN_PASSWORD` mitgeben, nie den lokalen Standard `soulwick-admin-local`.
Der Seed verweigert `NODE_ENV=production`; in `production` nie ausführen.

Danach Web und Admin prüfen: Admin-Login, Ranglisten, `/delete-account`, `/imprint` und `/privacy`
(mit beiden eRecht24-Schlüsseln erscheint der Text, sonst der Platzhalter).

## 8. Admin-Bereich zusätzlich schützen (dringend empfohlen)

Das Admin-Panel hat eine eigene Anmeldung, sollte aber nicht offen im Internet stehen. Eine der folgenden
Möglichkeiten zusätzlich nutzen:

- **Basic Auth** in Dokploy (Application → **Security**): Benutzer/Passwort vor der Login-Seite.
  Einfachste Lösung für die Testphase.
- **IP-Freigabe** über eine Traefik-Middleware (`ipAllowList`) für `admin.playsoulwick.com` und
  `admin-dev.playsoulwick.com`.
- **VPN** (z. B. Tailscale/WireGuard) und den Admin-Container gar nicht öffentlich veröffentlichen.
- **Cloudflare Access** (Zero Trust) vor den Admin-Hosts (`admin`, `admin-dev`); der Proxy ist ohnehin
  an (§2).

Admin-Passwörter: mindestens 12 Zeichen, pro Person ein eigener Zugang (das Protokoll zeigt, wer was
geändert hat), Zugänge ausgeschiedener Personen deaktivieren.

## 9. Migrationen

- Neue Migrationen entstehen lokal mit `bun run db:migrate --name <name>` in
  `packages/db/prisma/migrations/` und laufen beim Start des neuen API-Containers
  (`prisma migrate deploy`). Bestehende Migrationen nie nachträglich ändern; `bun run db:verify` muss vor
  dem Push grün sein (läuft im Husky-`pre-push`).
- **Migrationen müssen rückwärtskompatibel zum laufenden Container sein.** Beim Deploy läuft der alte
  Container weiter, bis der neue gesund ist; dazwischen arbeitet der alte Code auf dem schon migrierten
  Schema. Deshalb: zuerst Spalte/Tabelle **hinzufügen** (nullable oder mit Default), Code umstellen, erst
  in einem späteren Release Altes **entfernen**. Spalten nie umbenennen, sondern neu anlegen und später
  die alte löschen.
- Ein Rollback in Dokploy (**Deployments → Redeploy** eines älteren Builds) setzt nur den Code zurück,
  nicht die Datenbank; auch dafür braucht es die Rückwärtskompatibilität.
- **Ausnahmen vor dem ersten Deployment:** `automatic_account_deletion` (P-026) und `better_auth`
  (P-027) entfernen alte Tabellen im selben Schritt, in dem die neuen entstehen. Das ist nur zulässig,
  weil noch keine Umgebung läuft. Läuft schon eine Umgebung mit einem älteren Stand, im Wartungsfenster
  deployen und Relay und API derselben Umgebung zusammen aktualisieren (der neue Relay braucht
  `/auth/jwks` der neuen API).
- Zustand ansehen: im API-Container `cd packages/db && bunx prisma migrate status`.

## 10. Release-Ablauf

1. **Lokal prüfen:** `bun run check`, `bun run typecheck`, `bun test`, `bun run build` müssen grün sein,
   bei Schemaänderungen zusätzlich `bun run db:verify`; bei Dockerfile-Änderungen das Image einzeln
   bauen (`docker build -f apps/<app>/Dockerfile .`).
2. **development:** Jeder Push auf den Dev-Branch deployt automatisch die betroffenen Apps (Watch Paths).
   Danach `https://api-dev.playsoulwick.com/health`, Relay-`/health`, Admin-Login und Ranglisten prüfen;
   bei Vertragsänderungen den Test-Build des Spiels dagegen laufen lassen.
3. **production:** den Branch `production` nur vorspulen, nie direkt darauf committen:

   ```bash
   git fetch origin
   git push origin main:production
   ```

   Dokploy baut die betroffenen Apps. Anschließend `https://api.playsoulwick.com/health`, Relay und
   Admin-Login prüfen.
4. **Spielversionen:** Mit jedem veröffentlichten Spiel-Build `KNOWN_GAME_VERSIONS` der API ergänzen
   (aktuelle und vorige Version, kommagetrennt). Ändert sich das Netzwerkprotokoll, `PROTOCOL_VERSION`
   der Umgebung zusammen mit dem Spiel-Build erhöhen (API und Relay lesen denselben Wert, danach beide
   neu deployen). Alte Spiele sperren: `MIN_GAME_VERSION` anheben. Bei inkompatiblen Vertragsänderungen
   `API_VERSION` in `packages/contracts` erhöhen.
5. **Rollback:** in Dokploy den vorigen Build erneut deployen (§9 beachten).

## 11. Betrieb und Monitoring

- **Logs:** API und Relay schreiben JSON-Zeilen auf stdout (Anfragen, Fehler, Räume; der Relay **ohne**
  Paketinhalte), in Dokploy unter **Logs**.
- **Health:** `GET /health` von API (503 bei Datenbankfehler) und Relay (503 beim Herunterfahren) von
  außen überwachen, z. B. mit einem Uptime-Dienst im Minutentakt.
- **Relay-Metriken:** `GET /metrics` mit `x-relay-key` liefert Räume, Spieler, Bytes/s ein und aus,
  Verbindungen und abgelehnte Verbindungen (ohne gesetzten `RELAY_INTERNAL_KEY` antwortet der Pfad 404).
  Dieselben Zahlen je Raum zeigt das Admin-Panel unter „Live-Räume“.
- **Traffic und Kosten:** Der Relay schickt jedes Paket weiter (Host → Relay → Clients), der Traffic
  wächst also mit Spielern und Spielzeit. Nach den ersten Abenden Bytes/s je Raum ablesen, auf die
  erwartete Spielzeit hochrechnen und mit dem Inklusivtraffic des VPS (Hetzner) vergleichen.
- **Ausfall:** Ist API oder Relay nicht erreichbar, zeigt das Spiel einen Status und bleibt allein
  spielbar. Vorgehen: Logs ansehen, Container neu starten, bei fehlgeschlagener Migration den vorigen
  Build deployen und die Migration lokal reparieren (neue Migration, nie die alte ändern).
- **`DEV_AUTH_KEY`** ist für Werkzeuge und Tests; Test-Builds brauchen ihn mit `GUEST_AUTH_ENABLED=true`
  nicht. Wird er bekannt: neuen Schlüssel setzen und API neu deployen.
- **Ranglisten zurücksetzen** (zum Steam-Start): im Datenbank-Terminal nach einem Backup
  `DELETE FROM runs;` ausführen (Run-Teilnahmen werden mitgelöscht).

## 12. Test-Build an einen Freund geben

Gebaut wird im **Spiel-Repo** (derzeit im Worktree `soulwick-mp`, Branch `feature/multiplayer`, weil
`online/` nur dort liegt). Details: dortige `docs/MULTIPLAYER.md` §3d.

1. Einmalig die **Export-Vorlagen** für Godot 4.7.2 installieren (Editor → *Editor → Export-Vorlagen
   verwalten* → *Herunterladen und installieren*). Das Skript bricht sonst vor dem Export ab.
2. Im Repo-Root des Spiels exportieren:

   ```powershell
   powershell -ExecutionPolicy Bypass -File tools/export_build.ps1 -Env development -Platforms windows
   ```

   Parameter: `-Env development|production` (Standard `development`), `-Version` (muss
   `application/config/version` in `project.godot` entsprechen, Standard genau diese), `-Platforms
   windows` bzw. `linux` (ohne Angabe beide), `-Godot <pfad>` (Standard `C:\Tools\Godot\Godot_v4.7.2-stable_win64.exe`
   oder `$env:GODOT`), `-SkipBootTest`. Ergebnis:
   `builds/development/<version>/Soulwick-<version>-development-windows.zip` mit `LIESMICH.txt`.
3. Die ZIP privat weitergeben. **Beide** Spieler brauchen denselben Build (der Relay lässt nur gleiche
   Spielversion und Protokollversion in einen Raum).
4. Der Freund entpackt, startet `Soulwick.exe` (SmartScreen: *Weitere Informationen → Trotzdem
   ausführen*, der Build ist nicht signiert) und legt einen Spielstand an; der Name wird sein Online-Name.
   Er meldet sich automatisch als **Gast** an (`POST /auth/device`, kein Dev-Schlüssel nötig, solange
   `GUEST_AUTH_ENABLED=true`).
5. Hauptmenü unten rechts: „v0.9.0 dev“ und „Online bereit“. Steht dort der Offline-Hinweis, zuerst
   `https://api-dev.playsoulwick.com/health` prüfen.
6. Im Dorf ins **Gildengebäude**: Der Host wählt **Raum erstellen** und schickt den 6-stelligen
   **Raumcode**, der Freund gibt ihn ein und wählt **Raum beitreten**; der Host drückt **Starten**.
   Keine Portfreigabe, kein VPN.
7. Rückmeldung: Lag, Abbrüche mit Uhrzeit, `godot.log` aus `%APPDATA%\Godot\app_userdata\Soulwick\logs\`.

## 13. Produktion später einrichten

Wie §0, mit diesen Unterschieden: Umgebung `production`, Branch `production`, Hosts ohne `dev.` (§2),
eigene Geheimnisse und eigene Datenbank, `SUPPORT_EMAIL` Pflicht, `www.playsoulwick.com` als Weiterleitung,
tägliches Backup Pflicht, **keine** Demo-Daten. Zum Steam-Start `DEV_AUTH_ENABLED=false`. Spiel-Builds
für Produktion mit `-Env production`.

## Bekannte Grenzen

- Rate-Limits und Admin-Login-Limit zählen je API-Prozess, Räume liegen im Speicher des Relays (deshalb
  je genau 1 Replica).
- Web und Admin rufen die API serverseitig auf; für das Rate-Limit sind das alle Anfragen von einer IP
  (dem Container). Über das interne Netz fällt das kaum ins Gewicht; bei viel Traffic die Besucher-IP
  weiterreichen.
- Ein Relay je Umgebung für alle Regionen; Relays je Region sind später vorgesehen (ROADMAP „Später“).
- Diese Anleitung ist noch nicht auf dem Server erprobt; Abweichungen beim ersten Einrichten hier
  nachtragen.
