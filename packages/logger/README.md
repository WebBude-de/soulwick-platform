# @soulwick/logger

Gemeinsamer Logger von API und Relay, ohne externe Abhängigkeit (Bun-Datei-Writer). Wird als
TypeScript-Quelle genutzt wie `@soulwick/contracts`.

## Was er kann

- **Stufen** `debug`, `info`, `warn`, `error`; `LOG_LEVEL` ist die niedrigste geschriebene Stufe,
  `silent` schreibt nichts (Tests).
- **Konsole:** `LOG_FORMAT=pretty` (Standard außerhalb von `production`) sieht aus wie der
  Next.js-Dev-Server, ohne etwas wegzulassen: Uhrzeit gedimmt, Symbol statt Level-Wort (`·` debug,
  `○` info, `⚠` warn, `⨯` error), kein App-Name (den zeigt Turbo), alle Felder gedimmt als
  `key=value` (verschachtelte Werte als kompaktes JSON), Stacks eingerückt darunter. `listening` wird
  zum Startblock, `signal` zu `Stopped`, Anfragen zeigen den Status farbig nach Klasse. Farben nur im
  Terminal und ohne `NO_COLOR`:

  ```text
  05:07:32.568 ▲ Soulwick API
               - Local:  http://localhost:3102
               - Logs:   logs/api/
  05:07:32.570 ✓ Ready in 120ms
  05:07:35.510   GET /leaderboards/solo 200 in 16ms  ip=::1
  05:07:35.600 ⚠ GET /admin/me 401 in 1ms  ip=::1 code=unauthorized
  05:07:36.001 ○ housekeeping_done  removed=3
  ```

  `LOG_FORMAT=json` (Standard in `production`) schreibt eine JSON-Zeile
  `{"time","level","app","msg",...felder}`. `debug`/`info` gehen auf stdout, `warn`/`error` auf stderr.
- **Dateien** (nur mit Log-Ordner): `<LOG_DIR>/<app>/<YYYY-MM-DD>/all.jsonl` (alles), `all.log` (alles,
  eine Zeile mit Uhrzeit, Level-Wort und App, ohne Farben:
  `12:34:56.789 INFO  api  request  GET /admin/me 200 3ms ip=::1`) und `debug.jsonl`, `info.jsonl`, `warn.jsonl`, `error.jsonl` (je nur ihre Stufe).
  Ein neuer Tag beginnt einen neuen Ordner (lokales Datum); dabei werden Ordner gelöscht, die älter als
  `LOG_RETENTION_DAYS` (TESTWERT 7, heute mitgezählt) sind. Geschrieben wird gepuffert und im
  Anhänge-Modus, spätestens jede Sekunde und beim Beenden (`process.on("exit")` in `src/index.ts`).
  Ist der Ordner nicht beschreibbar, kommt einmal `log_files_disabled` auf stderr, danach nur Konsole.
- **Log-Ordner:** `LOG_DIR` (relativ = ab Repo-Wurzel); leer = `<repo>/logs` außerhalb von
  `production`, in `production` keine Dateien; `off` = keine Dateien.

## Regeln

- Nie Paketinhalte, Tokens, Passwörter oder E-Mail-Adressen loggen; nur IDs, Codes, Zähler, Gründe.
- Nachrichten (`msg`) sind stabile snake_case-Namen (`room_created`, `request`), Details in Feldern.
- Einrichtung je App: `apps/api/src/lib/logger.ts`, `apps/relay/src/logger.ts` (`initLogging(config)`
  einmal beim Start, `createLogger(config.LOG_LEVEL)` überall). Ohne `initLogging` (Tests, Skripte)
  schreiben Logger nur auf die Konsole.

## Prüfen

`bun test packages/logger` (Stufen-Filter, Formate, Dateiaufteilung, Rotation und Aufbewahrung mit
fester Uhr in einem Temp-Ordner).
