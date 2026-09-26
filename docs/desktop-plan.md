# Desktop App — Implementation Plan

**Goal:** ship Invoice (Crater, Laravel 8.83 + Vue 3) as a single installable Windows app that works
with no internet connection and no Docker. Everything (UI, API, database, PDFs) runs on the
user's machine.

**Last updated:** 2026-09-26 · **Current phase:** 3 — next up

## How to use this document

- Tick items (`- [x]`) as they land; add the date and a one-line note to the [Progress log](#progress-log).
- When a decision changes, update [Decisions](#decisions) rather than editing history in the log.
- New problems found during implementation go under [Risks & findings](#risks--findings).
- Status markers on phases: ⬜ not started · 🟨 in progress · ✅ done · ⏸ deferred

---

## Decisions

| # | Decision | Status |
|---|----------|--------|
| D1 | **Plan B: self-contained app.** Electron starts a bundled PHP runtime serving the Laravel app from `127.0.0.1`, backed by SQLite. | Locked |
| D2 | **Purely offline.** No feature may require the internet to work. Online-only features are disabled, not left half-working. | Locked |
| D3 | **Hybrid (hosted/sync) is out of scope.** It gets its own design later. We keep one seam for it: a single `APP_MODE` switch (see Phase 7). | Locked |
| D4 | **Remove the browser-side offline layer** (Dexie/IndexedDB outbox, offline login bypass, service worker). With a local backend it's redundant, and it's buggy (see Phase 2). A future hybrid sync is designed server-side, not rebuilt from this. | Locked |
| D5 | **Drop NativePHP.** It requires Laravel 10+; this is Laravel 8. We use plain Electron + portable PHP. | Locked |
| D6 | **PHP 8.1 (NTS, x64)**, the newest version Laravel 8.83 supports. Upgrading Laravel is a separate, later project. | Locked |
| D7 | **Keep the login screen** (single local user, "remember me" on). Protects data on a shared PC. | Locked |
| D8 | **Email sending disabled** in offline mode; invoices/estimates/payments are downloaded as PDF or printed. | Locked |
| D9 | **Per-user install** (NSIS, `%LOCALAPPDATA%\Programs\Invoice`), no admin rights needed. User data in `%APPDATA%\Invoice`. | Locked |
| D10 | **Fixed local port** `127.0.0.1:8765`, falling back to a free port if taken. Data lives in SQLite, so a port change only costs the login session. | Locked |

---

## Target architecture

```
Invoice.exe (Electron main process)
 ├─ single-instance lock
 ├─ first run: create user-data dirs, write .env, generate APP_KEY
 ├─ every launch: back up DB → php artisan migrate --force
 ├─ spawns: resources/php/php.exe -S 127.0.0.1:8765 server.php   (cwd = resources/app)
 ├─ every 60s while open: php artisan schedule:run
 └─ BrowserWindow → http://127.0.0.1:8765/admin   (webSecurity on, external links → system browser)

resources/                       (install dir, read-only at runtime)
 ├─ app/        Laravel app + vendor (composer --no-dev), public/build from Vite
 └─ php/        portable PHP 8.1 + php.ini

%APPDATA%\Invoice\               (user data, survives upgrades/uninstall)
 ├─ .env
 ├─ database.sqlite
 ├─ storage/    app/ (media, receipts, logos), fonts/ (dompdf), framework/, logs/
 ├─ cache/      Laravel bootstrap caches (config, routes, services, packages)
 └─ backups/    automatic pre-migration + manual backups
```

---

## Phase 0 — Groundwork ✅

- [x] `git init`, first commit of the current state (baseline to diff against). Repo-local `core.autocrlf=false` and
      `core.eol=lf` so Git keeps LF line endings (the Docker containers run these files on Linux).
- [x] `.gitignore`: add `/dist`, `/build/php`, `/build/stage`, `/public/build`, `/.desktop-data`, `*.sqlite`.
- [x] Record baseline: installer 118,574,015 bytes (113 MiB); `app.asar` 61,350,680 bytes (58.5 MiB).

## Phase 1 — Undo the static-SPA approach and fix web regressions ✅

The current build serves `public/` as static files from Electron. Laravel will serve the app again,
so these pieces go.

- [x] `vite.config.ts`: set `publicDir: 'resources/static'` (fonts and `/img/*` were 404 everywhere),
      so `public/` stops being copied into `public/build/`. Also restored `base: '/build/'` — without it,
      route-chunk preloads (and their CSS) pointed at `/assets/...` and 404'd under Laravel.
- [x] Replaced `new URL('/img/...', import.meta.url)` (resolves to the site root, 404) with
      `` `${import.meta.env.BASE_URL}img/...` `` in 5 components, and a hard-coded
      `http://localhost:3000/img/default-avatar.jpg` in `ModuleCard.vue`.
- [x] Delete `public/index.html`, `public/build/index.html`, and the nested copies in `public/build/`
      (`index.php`, `sw.js`, `offline.html`, `.htaccess`, `web.config`, `robots.txt`, `favicons/`).
- [x] `resources/scripts/main.js`: remove the `window.Crater.start()` call; Blade already calls it
      after module scripts register their booting callbacks.
- [x] Delete `config/nativephp.php` and `app/Providers/NativeAppServiceProvider.php`
      (wrong namespace — autoload is `Crater\` — and never registered).
- [x] Removed the `laravel-vite` npm package. The Blade `@vite` directive comes from the Composer package
      `innocenzi/laravel-vite`, which only reads `public/build/manifest.json` — confirmed working.
- **Done when:** `npm run build` then Docker web app loads with Poppins font and logos, no console errors, app mounts once.
- **Result:** verified at `http://localhost/login` — one Vue app mounted, Poppins loaded from `/build/fonts/`,
  all `/build/...` assets 200. Remaining console errors (service-worker registration, two 401s from
  `hydrateReferenceData` before login) belong to Phase 2.
- **Note:** `npm run desktop:start` / the current Electron build no longer show the UI (they relied on
  `public/index.html`). Expected until Phase 5 replaces `desktop/main.js`.

## Phase 2 — Remove the browser-side offline layer ✅

Why: with a local backend, `navigator.onLine === false` (e.g. Wi-Fi off) would divert saves into
IndexedDB even though the local server is right there. It also has known bugs: local IDs never
remapped, local-only fields sent to the server, false "all synced" message, and any-password login
on network error.

- [x] Stores `invoice.js`, `estimate.js`, `customer.js`, `item.js`: remove `navigator.onLine` branches,
      `db.*` writes and `syncManager` calls.
- [x] Also found by diffing against upstream Crater `master` (the project's base): `global.js` faked a whole
      session when bootstrap failed (owner user, all abilities, fake "My Business" company); `user.js`
      reported account updates as saved when they weren't; `Login.vue` had a PWA-install/"Download .exe"
      panel and a box showing and auto-filling the seeded admin credentials (conflicts with D7).
- [x] Resolution: these 9 files (7 stores, `Login.vue`, `TheSiteHeader.vue`) restored to upstream `master`
      (user-approved), then the local removal of debug `console.log`s in `estimate.js` re-applied.
      Upstream was the right baseline because the offline code was the only local change in them.
- [x] `auth.js`: remove the "authorizing offline desktop session" fallbacks; network errors reject.
- [x] Delete `resources/scripts/services/offline/`, `components/offline/OfflineStatusBadge.vue` and its usage.
- [x] `main.js`: remove `syncManager` import/init.
- [x] Remove service worker: registration in `app.blade.php` and `public/offline.html` removed. `public/sw.js`
      replaced by a self-unregistering worker that clears its caches, since browsers keep running an
      installed worker even after its script starts returning 404. Delete it after one release.
- [x] Remove `dexie` from `package.json`.
- **Done when:** `grep -r "dexie\|syncManager\|navigator.onLine\|serviceWorker" resources/` is empty and create/edit flows work.
- **Result:** grep empty; build and lint pass; login page loads with no failed requests, no service
  worker, no credentials box; wrong credentials correctly rejected (422). Logged in with a throwaway
  test user (`claude-test@example.test`, company 1, `super admin`) and created + edited a customer,
  item, invoice and estimate through their create/edit pages; every request succeeded and the saved
  values were confirmed in the database. No console errors after the post-rebuild reload.
- Restoring `TheSiteHeader.vue` from upstream re-introduced a root `/img/` URL (Phase 1 fix);
  re-applied, plus one in `BaseGlobalLoader.vue` that Phase 1 missed.
- **Note:** browsers that ran the earlier build keep an orphaned `InvoiceOfflineDB` IndexedDB (cached
  customers/items). Irrelevant to the desktop app (new origin); clear it manually in any dev browser.

## Phase 3 — Make Laravel run from a read-only install dir ⬜

Everything writable moves to the user-data dir, passed in by Electron as `INVOICE_DATA_DIR`.

- [ ] `bootstrap/app.php`: if `INVOICE_DATA_DIR` is set, `useStoragePath(<data>/storage)` and
      `useEnvironmentPath(<data>)`.
- [ ] Bootstrap caches: Electron sets `APP_CONFIG_CACHE`, `APP_ROUTES_CACHE`, `APP_SERVICES_CACHE`,
      `APP_PACKAGES_CACHE`, `APP_EVENTS_CACHE` to `<data>/cache/*.php`.
- [ ] `app/Space/EnvironmentManager.php`: write to `app()->environmentFilePath()` instead of `base_path('.env')`.
- [ ] SQLite: `DB_CONNECTION=sqlite`, `DB_DATABASE=<data>/database.sqlite`; enable WAL + `foreign_keys`.
- [ ] dompdf: `font_dir`/`font_cache` already use `storage_path('fonts/')`; first run copies the bundled
      `storage/fonts/*` into the user storage dir.
- [ ] `public/storage` symlink: replace with a route or `php -S` router rule that serves
      `<data>/storage/app/public` (symlinks in the install dir aren't reliable on Windows).
- [ ] Verify **all migrations and seeders run on SQLite** from an empty DB (Crater supports SQLite, but check
      any custom migrations).
- **Done when:** app runs with the source tree made read-only and all state in a temp `INVOICE_DATA_DIR`.

## Phase 4 — Bundle the PHP runtime and the app ⬜

- [ ] `scripts/fetch-php.mjs`: download pinned PHP 8.1.x NTS x64 zip from windows.php.net, verify SHA-256,
      extract to `build/php/`.
- [ ] `build/php.ini`: enable `pdo_sqlite`, `sqlite3`, `mbstring`, `gd`, `zip`, `bcmath`, `exif`, `fileinfo`,
      `intl`, `openssl`, `curl`; `memory_limit=512M`; `opcache` on; `display_errors=Off`.
      Imagick is not needed (`config/image.php` and media-library can use `gd`).
- [ ] `scripts/stage-app.mjs`: copy Laravel app into `build/stage/app/` (exclude `node_modules`, `tests`, `docker-compose`,
      `uffizzi`, `.github`, `dist`, `_ide_helper.php`, `storage/*` except fonts), then
      `composer install --no-dev --optimize-autoloader --classmap-authoritative` in the stage dir.
- [ ] Smoke test: `build/php/php.exe -m` lists all required extensions; `php artisan --version` runs in stage.

## Phase 5 — Electron main process rewrite (`desktop/main.js`) ⬜

- [ ] Single-instance lock; second launch focuses the existing window.
- [ ] Splash window while starting; error window with log path if startup fails.
- [ ] First run: create data dirs, write `.env` from a template (`APP_ENV=production`, `APP_DEBUG=false`,
      `APP_URL`, `SESSION_DRIVER=file`, `SANCTUM_STATEFUL_DOMAINS=127.0.0.1:<port>`, `MAIL_MAILER=log`),
      generate `APP_KEY` (Node `crypto.randomBytes(32)`).
- [ ] Every launch: copy `database.sqlite` to `backups/pre-migrate-<version>-<timestamp>.sqlite`
      (keep last 5), then `php artisan migrate --force`, then `config:cache` / `route:cache`.
- [ ] Start PHP server (`php -S 127.0.0.1:<port> server.php`, cwd = app dir); poll until it answers; then load `/admin`.
- [ ] Update `APP_URL` / `SANCTUM_STATEFUL_DOMAINS` in `.env` if the fallback port is used.
- [ ] Scheduler: run `php artisan schedule:run` every 60 s while the app is open (replaces the Docker cron container).
- [ ] Shutdown: kill PHP process tree on quit (`taskkill /pid <pid> /T /F` on Windows); handle PHP crash → offer restart.
- [ ] Security: `webSecurity: true`, `contextIsolation: true`, `sandbox: true`; `setWindowOpenHandler` →
      `shell.openExternal` for non-local URLs; block `will-navigate` away from the local origin.
- [ ] Downloads: PDFs and backups go through a native save dialog (`will-download`). Printing via `webContents.print()`.
- [ ] Logs: Electron log + PHP stdout/stderr to `<data>/storage/logs/desktop.log`.

## Phase 6 — First-run setup flow ⬜

The web installer has 8 steps; steps 1–5 are server-admin concerns the desktop app handles itself.

- [ ] Electron (or an artisan command `desktop:provision`) runs migrations + seeders and writes the
      `database_created` marker, so the web installer's DB step is skipped.
- [ ] Skip Step1 Requirements, Step2 Permissions, Step3 Database, Step4 Domain, Step5 Email
      (start the wizard at `profile_complete` for Step6).
- [ ] Keep Step6 Account, Step7 Company, Step8 Preferences.
- **Done when:** fresh install goes straight to "create your account" → company → preferences → dashboard.

## Phase 7 — Disable online-only features (`APP_MODE=desktop`) ⬜

One switch, `config('crater.mode')` from `APP_MODE` (`web` default, `desktop` for this app), exposed to the
frontend via the bootstrap response. This is the seam the hybrid work will use later.

- [ ] In-app updater (`Admin/Update/*`, version check against craterapp.com) — routes off, menu hidden.
      Updates come from new installers.
- [ ] Modules marketplace (`Admin/Modules/*`) — routes off, menu hidden.
- [ ] Exchange-rate providers (currencyfreaks, currencylayer, currconv) — hidden; manual exchange rates stay.
- [ ] Customer portal and Stripe payments — routes off, menu/links hidden (customers can't reach localhost).
- [ ] Email: "Send" actions hidden, mail settings hidden (D8). Download/print stay.
- [ ] Backup settings: local disk only; cloud disks (Dropbox, S3, etc.) hidden.
- [ ] Remove `@stripe/stripe-js` from the desktop bundle if unused elsewhere.
- **Done when:** with the network adapter disabled, no screen shows an action that fails because it's offline.

## Phase 8 — Data safety ⬜

Data exists on one machine only, so this is required, not optional.

- [ ] "Back up now": zip `database.sqlite` (via SQLite online backup / `VACUUM INTO`) + `storage/app` → save dialog.
- [ ] "Restore": pick a backup zip → validate → stop PHP → swap in → migrate → restart.
- [ ] Optional reminder if no backup in N days.
- [ ] Uninstaller keeps `%APPDATA%\Invoice` (electron-builder default `deleteAppDataOnUninstall: false`); document it.

## Phase 9 — Packaging ⬜

- [ ] `package.json` → move all frontend runtime libs from `dependencies` to `devDependencies`
      (Vite bundles them; today they add ~60 MB to `app.asar`). Electron main needs no runtime deps.
- [ ] electron-builder config:
  - `files`: `desktop/**` only.
  - `extraResources`: `build/stage/app` → `app`, `build/php` → `php` (PHP can't read inside `app.asar`).
  - `win.icon`: `build/icon.ico` (256×256, from `public/favicons/android-chrome-512x512.png`).
  - `nsis`: `oneClick: false`, `perMachine: false`, `allowToChangeInstallationDirectory: true`,
    desktop + Start Menu shortcuts.
- [ ] Scripts: `desktop:prepare` = `vite build` → `fetch-php` → `stage-app`; `desktop:build` = `desktop:prepare` → `electron-builder`.
- [ ] Dev mode: `desktop:start` uses the source tree + `build/php` with `INVOICE_DATA_DIR=./.desktop-data`.
- [ ] Code signing: ⏸ until a certificate is available (SmartScreen will warn until then).
- [ ] macOS / Linux targets: ⏸ (README updated to say Windows only for now).

## Phase 10 — Verification ⬜

Run on a clean Windows 11 VM **with networking disabled**.

- [ ] Install without admin rights; shortcuts created; app icon correct.
- [ ] First run → onboarding → dashboard.
- [ ] Create customer, item, invoice, estimate, payment, expense (with receipt upload).
- [ ] Invoice/estimate/payment PDFs render with correct fonts and logo; save dialog works; print works.
- [ ] Reports (sales, P&L, tax summary) open.
- [ ] Close and reopen: all data and logos still there; still logged in.
- [ ] Launch twice: second launch focuses the first window.
- [ ] Occupy port 8765 beforehand: app falls back and works.
- [ ] Kill `php.exe` while running: app detects it and offers restart.
- [ ] Recurring invoice is generated by the scheduler while the app is open.
- [ ] Install version N+1 over N with a new migration: pre-migrate backup created, data intact.
- [ ] Backup → wipe data dir → restore: data back.
- [ ] Uninstall: data dir remains; reinstall picks it up.
- [ ] Install path with spaces and a OneDrive-synced user profile.
- [ ] Windows Defender doesn't quarantine `php.exe`.
- [ ] Installer size recorded vs. baseline.

## Later — Hybrid / hosted version ⏸

Out of scope. Notes to carry forward:
- `APP_MODE` (Phase 7) is the switch point.
- Needs a real sync design: server-assigned or UUID IDs, conflict rules, per-entity change log, auth to a remote server.
  Not a revival of the removed Dexie outbox.
- Online features disabled in Phase 7 come back under `APP_MODE=web`/`hybrid`.

---

## Risks & findings

| Risk | Impact | Mitigation |
|------|--------|-----------|
| PHP's built-in server handles one request at a time on Windows (`PHP_CLI_SERVER_WORKERS` is unsupported there). The UI fires parallel API calls. | Slower screens, especially PDFs. | Measure in Phase 5. If too slow, switch to `php-cgi.exe` behind a small bundled web server (e.g. Caddy) — isolated to `desktop/main.js`. |
| PHP 8.1 is past end of security support. | Low exposure for a localhost-only app, but not zero. | Bind to `127.0.0.1` only; plan the Laravel upgrade separately (D6). |
| Some migrations/queries may be MySQL-specific. | First-run or feature failures on SQLite. | Phase 3 full migrate + seed + smoke test on SQLite. |
| Unsigned installer. | SmartScreen warning; users may not proceed. | Get a code-signing cert before distribution. |
| AV false positives on bundled `php.exe`. | App won't start. | Use official php.net binaries unmodified; test in Phase 10. |
| Docker dev setup is very slow on this machine (~15 s per request), because PHP reads the project over a bind mount from a OneDrive folder. | Slow manual testing only; doesn't affect the desktop build. | Consider moving the working copy out of OneDrive. |
| Main JS bundle is ~10 MB (2.5 MB gzipped); Vite warns on chunk size. | Slower first paint, even from local disk. | Not blocking. Look at locales/vendor splitting after Phase 9. |
| Long paths in `vendor/`. | Install failures on old Windows configs. | `--classmap-authoritative`, keep install path short; test in Phase 10. |

---

## Progress log

| Date | Phase | Note |
|------|-------|------|
| 2026-09-26 | — | Plan created after gap investigation. Existing installer (`dist/Invoice Setup 1.0.0.exe`) serves `public/` statically with no backend; not usable. |
| 2026-09-26 | — | Decisions D4, D6–D10 confirmed. |
| 2026-09-26 | 0 | Git repo initialised, baseline commit, `.gitignore` updated, baseline sizes recorded. |
| 2026-09-26 | 1 | Vite config restored (`base`, `publicDir`), root-relative image URLs fixed, double `Crater.start()` removed, static `index.html` + NativePHP leftovers + `laravel-vite` npm package removed. Verified in Docker web app. |
| 2026-09-26 | 2 | Offline layer removed (stores/auth/login/header restored to upstream, offline modules + `dexie` deleted, service worker retired). Create/edit flows verified for customer, item, invoice, estimate. |
