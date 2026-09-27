# Desktop App — Implementation Plan

**Goal:** ship Invoice (Crater, Laravel 8.83 + Vue 3) as a single installable Windows app that works
with no internet connection and no Docker. Everything (UI, API, database, PDFs) runs on the
user's machine.

**Last updated:** 2026-09-26 · **Current phase:** 10 — in progress (installer tested on the dev machine; clean offline VM pending)

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
| D9 | **Per-user install** (NSIS, `%LOCALAPPDATA%\Programs\Invoice`), no admin rights needed. User data in `%APPDATA%\Invoice\data` (see Target architecture). | Locked |
| D10 | **Fixed local port** `127.0.0.1:8765`, falling back to a free port if taken. Data lives in SQLite, so a port change only costs the login session. | Locked |
| D11 | **VC++ runtime deployed app-locally.** PHP needs `vcruntime140.dll`, `vcruntime140_1.dll`, `msvcp140.dll`, which a clean Windows may lack. Installing the VC++ redistributable needs admin (conflicts with D9), so the three DLLs ship next to `php.exe`, copied from the Visual Studio redist folder at build time. | Locked |
| D12 | **Missed recurring invoices: catch up (option a).** Crater generates recurring invoices only while its scheduler runs, so occurrences while the app is closed were skipped. At launch, the app generates one invoice per missed occurrence (dated when due) and lists them in a notice. See "D12 — Recurring invoice catch-up". | Locked |
| D13 | **Password recovery: "Reset Invoice password".** Email reset is unavailable offline (D8). `Invoice.exe --reset-password` (a Start-menu shortcut, Phase 9) opens a window that sets a new password for the owner account. It needs the Windows account that holds the data, which can already read the data files, so D7's protection against casual access is unchanged. See "D13 — Password reset". | Locked |
| D14 | **Phase 7 hides, it doesn't remove.** Online-only features are hidden in the desktop UI; their backend (routes, controllers, packages) stays for web installs and a future hosted/hybrid version. | Locked |

---

## Target architecture

```
Invoice.exe (Electron main process — desktop/main.js, desktop/runtime.js)
 ├─ single-instance lock; splash while starting
 ├─ first run: create data dir, write .env (APP_KEY only)
 ├─ every launch: kill orphaned php.exe (PID file) → pick port 8765+ → clear config/route cache
 │   → back up DB if the app version changed → php artisan desktop:provision
 │     (create DB, migrate, catch-up status checks, config/route cache)
 ├─ spawns: resources/php/php.exe -S 127.0.0.1:<port> -t public server.php   (cwd = resources/laravel)
 │   env per process: INVOICE_DATA_DIR, APP_URL, DB_DATABASE, drivers — not written to .env
 ├─ at the start of every minute while open: php artisan schedule:run
 └─ BrowserWindow → http://127.0.0.1:<port>/admin/dashboard   (sandboxed; external links → system browser)

resources/                       (install dir, read-only at runtime)
 ├─ app.asar    desktop/* (Electron main process, preloads, splash, reset window)
 ├─ laravel/    Laravel app + vendor (composer --no-dev), public/build from Vite
 └─ php/        portable PHP 8.1 + php.ini + VC++ runtime DLLs

%APPDATA%\Invoice\               (Electron/Chromium profile: cookies, cache)
 └─ data\                        (app data — survives upgrades/uninstall)
    ├─ .env                      APP_KEY
    ├─ database.sqlite
    ├─ storage/                  app/ (media, receipts, logos), fonts/ (dompdf), framework/, logs/
    ├─ cache/                    Laravel bootstrap caches (config, routes, services, packages)
    ├─ backups/                  automatic pre-upgrade backups (Phase 8 adds manual ones)
    ├─ desktop-state.json        last started version
    └─ php-server.pid
```

The app data lives in a `data` subfolder because Chromium keeps a `Cache` folder in the Electron profile,
which would collide with Laravel's `cache` on a case-insensitive file system.

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

## Phase 3 — Make Laravel run from a read-only install dir ✅

Everything writable moves to the user-data dir, passed in by Electron as `INVOICE_DATA_DIR`.

- [x] `bootstrap/app.php`: if `INVOICE_DATA_DIR` is set, `useStoragePath(<data>/storage)` and
      `useEnvironmentPath(<data>)`, and create the storage/cache directories if missing.
- [x] Bootstrap caches: `APP_CONFIG_CACHE`, `APP_ROUTES_CACHE`, `APP_SERVICES_CACHE`,
      `APP_PACKAGES_CACHE`, `APP_EVENTS_CACHE` point to `<data>/cache/*.php`. Set in `bootstrap/app.php`
      rather than by Electron, so the web server, `artisan` and the scheduler all agree; Electron only
      passes `INVOICE_DATA_DIR`. `config:cache` and `route:cache` both work (closure routes included).
- [x] `app/Space/EnvironmentManager.php`: write to `app()->environmentFilePath()` instead of `base_path('.env')`.
      Same for the `ResetApp` command.
- [x] SQLite: `DB_CONNECTION=sqlite`, `DB_DATABASE=<data>/database.sqlite`. `CraterDatabaseSQLiteConnector`
      (bound as `db.connector.sqlite`) sets `busy_timeout` (default 5000 ms, `DB_BUSY_TIMEOUT`) and WAL on
      every connection — web server and scheduler are separate processes on one file.
- [x] **Foreign keys were off on SQLite.** Crater's `sqlite` config lacked `foreign_key_constraints`, so its
      `onDelete('cascade')` rules (always enforced on MySQL) would silently not run. Now on by default
      (`DB_FOREIGN_KEYS`). All migrations + seeders pass with it on; Pest suite 248/248 with it on and off.
- [x] dompdf: no font copying needed — `storage/fonts` only holds metric caches dompdf regenerates, and the
      Thai fonts load from `resources/static/fonts` (read-only is fine). **`chroot` was the real issue:** it
      only allowed the install dir, which would have silently dropped company logos from PDFs once storage
      moved. Now `[base_path(), storage_path()]`.
- [x] System file disks (`local_public`, `local_private`): Crater stores their absolute root and `APP_URL`
      in the database at migration time. `FileDisk::setConfig()` now takes `root`/`url` from the current
      config for system disks, so a moved/restored data dir or a changed port keeps working.
- [x] `public/storage` symlink: replaced by `GET /storage/{path}` (`PublicStorageController`), which serves
      `storage/app/public` and 404s anything resolving outside it. Web installs with the symlink never
      reach it (the web server answers first).
- [x] `php artisan desktop:provision`: creates the SQLite file if missing. Phase 6 extends it.
- [x] Verify **all migrations and seeders run on SQLite** from an empty DB.
- **Done when:** app runs with the source tree made read-only and all state in a temp `INVOICE_DATA_DIR`.
- **Result:** container with the project mounted **read-only**, `INVOICE_DATA_DIR` on tmpfs, SQLite and
  `php -S`: provision → migrate/seed → config/route cache → login → logo upload (served via `/storage/…`,
  traversal attempts 404) → customer + invoice → invoice PDF with the logo embedded. Every write landed in
  the data dir; no errors logged. Docker web install unaffected.

## Phase 4 — Bundle the PHP runtime and the app ✅

- [x] `scripts/fetch-php.mjs` (`npm run desktop:fetch-php`): downloads pinned PHP **8.1.34** NTS x64 (vs16)
      from windows.php.net (falls back to `/archives/`), verifies SHA-256, extracts with Windows' `tar.exe`
      to `build/php/`, installs `build/php.ini`, copies the VC++ runtime DLLs (D11). Zip cached in `build/cache/`.
- [x] `build/php.ini`: `curl`, `exif`, `fileinfo`, `gd`, `mbstring`, `openssl`, `pdo_sqlite`, `sodium`, `sqlite3`
      (`intl` dropped in Phase 9: nothing uses it and Crater's own Docker image never had it)
      as DLLs (`bcmath`, `zip`, `dom`, `tokenizer`, etc. are compiled in); OPcache on for CLI with
      `validate_timestamps=0`; `memory_limit=512M`; uploads 50M; `display_errors=Off`; `date.timezone=UTC`.
      **`extension_dir` must be passed as an absolute `-d` flag** — when unset, Windows PHP looks in
      `C:phpext`, and a relative value resolves against the working directory.
- [x] `scripts/stage-app.mjs` (`npm run desktop:stage`): copies an allow-list of runtime paths into
      `build/stage/app/` (no Vue/Sass sources, tests, Docker, storage), downloads pinned Composer 2.10.3
      (SHA-256 checked), runs `composer install --no-dev --no-scripts --classmap-authoritative` with the
      bundled PHP, then `composer check-platform-reqs --no-dev` (all pass).
- [x] Fixed: `config/app.php` registered `IdeHelperServiceProvider` (a `require-dev` package — upstream Crater
      bug), so a `--no-dev` install crashed on boot. Removed; package discovery still loads it in dev.
- [x] Fixed: Laravel 8 treats cache paths as absolute only if they start with `/` or ``, so `C:/…` cache
      paths were resolved under the install dir. `bootstrap/app.php` registers the data dir via
      `addAbsoluteCachePathPrefix()`.
- [x] Smoke test: `php -m` loads every extension with no warnings. Staged app run **natively on Windows**
      with the bundled PHP and a temp data dir: provision → migrate/seed → config/route cache in ~21 s;
      `php -S` serving; login, logo upload, customer, invoice and invoice PDF (logo embedded) all work;
      no log errors; nothing written inside the staged app.
- **Sizes:** `build/php` 79 MB, staged app 86.5 MiB (vendor: `aws` 29 MB, `dompdf` 9 MB, `phpunit` 4 MB
  pulled in by a non-dev test-assertions package). Trimming belongs to Phase 9.

## Phase 5 — Electron main process rewrite (`desktop/main.js`) ✅

Files: `desktop/main.js` (lifecycle, windows, security, downloads), `desktop/runtime.js` (data dir, PHP,
provisioning, server, scheduler), `desktop/log.js`, `desktop/splash.html`.

- [x] Single-instance lock; second launch focuses the existing window.
- [x] Splash window while starting; startup failures show a dialog with the error and an "Open log folder" button.
- [x] First run: create the data dir and write `.env` containing only a new `APP_KEY`. Everything derived
      from paths or the port (`INVOICE_DATA_DIR`, `APP_URL`, `SANCTUM_STATEFUL_DOMAINS`, `DB_DATABASE`,
      drivers, `MAIL_*=log`) is passed as environment to each PHP process instead — Laravel's env loading is
      immutable, so these win over `.env`, and a port change or moved data dir needs no `.env` edits.
- [x] Before migrating, back up the database when the app version differs from the last start
      (`backups/pre-upgrade-<old>-to-<new>-<timestamp>.sqlite`, plus `-wal` if present; keep 5). Migrations
      only change with a new version, so per-launch backups would just rotate useful ones out.
- [x] `desktop:provision` now does everything before serving in one PHP process: create DB, `migrate --force`,
      run `check:invoices:status` / `check:estimates:status` (scheduled at midnight upstream, when a desktop
      app is usually closed; both idempotent), `config:cache`, `route:cache`. Electron deletes the cached
      config/routes first so the current port and paths apply.
- [x] PHP spawned with absolute `-c`, `-d extension_dir`, `-d error_log`; dev adds `opcache.validate_timestamps=1`.
- [x] Server: `php -S 127.0.0.1:<port> -t public server.php`; waits for `/login` to answer; PID file written.
- [x] Port: 8765, else the next free port up to 8784. Cookies are scoped by host, not port, so even a
      fallback port keeps the login.
- [x] Orphans: on start, a PID file pointing at a live `php.exe` is killed (PID reuse is checked via `tasklist`).
- [x] Scheduler: `schedule:run` just after the start of every minute, never overlapping.
- [x] Shutdown kills the PHP process tree (`taskkill /T /F`); an unexpected PHP exit shows a Restart/Quit dialog.
- [x] Security: `contextIsolation`, `sandbox`, `webSecurity`, no Node in pages; `setWindowOpenHandler` allows
      same-origin windows (PDF previews) and sends http(s)/mailto to the system browser, blocking other
      schemes; off-origin navigation blocked; `<webview>` blocked; only the clipboard-write permission granted.
- [x] Downloads always show a Save dialog; the empty window a `window.open` download leaves is closed.
      PDFs render in Chromium's built-in viewer (which also prints), so no custom print command is needed.
- [x] Fixed `GeneratesPdfTrait`: PDF bodies no longer start with HTTP headers.
- [x] Logs: `<data>/storage/logs/desktop.log` (Electron + provisioning + non-routine PHP server output,
      rotated at 5 MB), `php.log` (PHP errors), Laravel's daily logs.
- [x] Window title pinned to "Invoice" (some pages have no `<title>`).
- **Result:** tested in dev mode (`npm run desktop:start`) with a fresh data dir: cold first start with all
  migrations ~4.5 s to ready, later starts ~4 s; login inside the Electron window; recurring invoice
  (`* * * * *`) generated exactly once per minute by the scheduler; PDF preview window with the Chromium
  viewer; report download → Save dialog → cancel; `file://` and unknown schemes blocked; no Node in
  pages; single-instance; clean quit leaves no `php.exe`; orphaned `php.exe` on 8765 killed and port reused;
  port 8765 held by something else → 8766 with the session intact; PHP killed mid-session → dialog →
  Restart recovered; version change → pre-upgrade backup.
- **Follow-ups:** report downloads are named `document.pdf` (upstream); packaged build needs
  `build.files` to include `desktop/**` (Phase 9); D12 (missed recurring invoices).

## Phase 6 — First-run setup flow ✅

The web installer has 8 steps; steps 1–5 are server-admin concerns the desktop app handles itself.

- [x] `desktop:provision` does what steps 1–5 would: on an empty database it runs the seeders (currencies,
      countries, default admin user + company) inside a transaction (they aren't idempotent), writes the
      `database_created` marker, and sets `profile_complete` to 5 unless setup is further along.
- [x] Wizard opens at Step 6 Account → Step 7 Company → Step 8 Preferences (unchanged Crater screens).
- [x] `Installation.vue`: when resuming at step 6 or later without a session, sign in through the installer's
      own login endpoint first. Steps 6–8 edit the signed-in user, and step 4 is what normally signs in —
      this also fixes the web installer when a browser is closed mid-setup.
- [x] Step 6 requires a new password, so the seeded `admin@craterapp.com` / `crater@123` stops working once
      the account step is done.
- **Done when:** fresh install goes straight to "create your account" → company → preferences → dashboard.
- **Result:** fresh data dir in the Electron app: seeded + marked on first start, wizard at "Account
  Information", steps 6–8 completed (including the currency confirmation) → dashboard for the new company.
  Database checked: one user with the new email/password, seed password rejected, `COMPLETED`. Restart →
  dashboard, no reseeding. The sign-in fallback ran for real (a stale cookie from a deleted data dir → 401).
- **Follow-up (Phase 7):** the wizard's progress indicator still counts the skipped server steps.

## D12 — Recurring invoice catch-up ✅

- [x] New nullable `recurring_invoices.last_run_at`: the last schedule occurrence handled. Both the
      scheduler and the catch-up set it, and `generateInvoice()` skips an occurrence at or before it, so
      the two can never create the same occurrence twice.
- [x] `generateInvoice($occurrence)`: invoices are dated on the day they were due (company time zone) with
      the due date offset from that; `DATE` limits compare against the occurrence; returns the invoice.
- [x] `RecurringInvoice::generateMissedInvoices()`: for each active schedule, every cron occurrence after
      `last_run_at` (or, for schedules predating the column, after their latest invoice or creation —
      never before a schedule existed) up to now; `COUNT`/`DATE` limits still complete the schedule;
      capped at 100 per schedule per start (the rest follow on the next start).
- [x] `desktop:provision` runs it before the status checks and prints a `DESKTOP_REPORT` line; Electron
      shows "While Invoice was closed, N recurring invoices were due…" with the list (first 10).
- [x] Fixed upstream: `next_invoice_at` was always computed from `starts_at`, so it never advanced.
- **Result:** schedule last run 3 days ago → 3 invoices dated 24/25/26 Sep, due +7 days, notice shown;
  a new schedule with a past start date → nothing backfilled; a `COUNT` limit of 2 with 3 missed →
  2 invoices then `COMPLETED`; relaunch → nothing created, no notice.

## Phase 7 — Disable online-only features (`APP_MODE=desktop`) ✅

One switch, `config('crater.mode')` from `APP_MODE` (`web` default, `desktop` for this app). The launcher
passes `APP_MODE=desktop`; `app.blade.php` exposes it as `window.app_mode` (set before any module runs, so
it also reaches the login and installer pages); the frontend reads it via `helpers/app-mode.js`. This is
the seam the hybrid work will use later. Per D14, features are hidden in the UI; backends stay.

- [x] Menus: `config('crater.desktop_hidden_links')` leaves out Modules, Exchange Rate (providers), Notifications,
      Mail Configuration, File Disk, Backup (Crater's backup needs the `sqlite3` CLI; Phase 8 replaces it) and
      Update App when building the menus (`AppServiceProvider::generateMenu`). Users and Roles stay.
- [x] In-app updater, modules marketplace: menu entries hidden. Updates come from new installers.
- [x] Exchange rates: provider settings hidden; with no provider the backend returns the last rate used or
      asks for one manually — no network call.
- [x] Customer portal: "Portal access" section hidden in the customer form and the quick-add customer modal;
      "Copy PDF URL" (a link customers would open) hidden in invoice/estimate/payment menus.
- [x] Email (D8): Send / Resend invoice, estimate and payment receipt hidden (view pages and row menus);
      "Send automatically" hidden on recurring invoices; "Forgot Password?" hidden on the login page (see D13).
      "Mark as sent", PDF view/download/print stay.
- [x] Cloud disks (Dropbox, S3, DigitalOcean Spaces): File Disk settings hidden.
- [x] `@stripe/stripe-js` removed — nothing in the frontend used it.
- [x] Installer progress shows 3 steps (6–8) in desktop mode instead of Crater's 7.
- **Done when:** with the network adapter disabled, no screen shows an action that fails because it's offline.
- **Result:** in the Electron app — menus without the hidden entries; invoice view shows "Mark as sent" but
  no Send or Copy PDF URL; customer form and modal without portal access; recurring form without "Send
  automatically"; login without "Forgot Password?"; installer with 3 progress dots. The Docker web install
  still reports `web` and keeps all 16 settings entries. The network-off pass is part of Phase 10.

## Phase 8 — Data safety ✅

Data exists on one machine only, so this is required, not optional.

- [x] Backup format: a zip with `manifest.json` (app/format/version, created_at, latest migration, company names,
      invoice count), `database.sqlite` (a `VACUUM INTO` snapshot — consistent while the app runs), `.env` (APP_KEY)
      and `storage/app/**` (logos, receipts, uploads). Written by `php artisan desktop:backup <path>` via a
      `.partial` file that is renamed only when complete.
- [x] `php artisan desktop:restore <path> [--inspect]`: refuses non-backups, other zips, backups from a newer
      version (manifest format or a migration this app doesn't have) and entries with `..`/absolute paths;
      extracts only the expected entries; checks `PRAGMA integrity_check`; disconnects before swapping (Windows
      can't replace open files); replaces database, `storage/app` and `.env`.
- [x] Desktop bridge: `desktop/preload.js` exposes four functions (`window.invoiceDesktop`) to the main window only;
      `main.js` rejects calls from any other sender or origin.
- [x] Settings → Backup shows `DesktopBackupSetting.vue` in desktop mode (Crater's server backup page stays for web):
      last backup, "Back up now" (Save dialog, default `Documents\Invoice backup <date>.zip`), "Restore from
      backup…", automatic backups + "Open backups folder".
- [x] Restore: pick file → inspect → confirmation with backup date, company and invoice count → stop scheduler and
      server → safety backup `backups/pre-restore-<ts>.zip` (keep 5) → restore → provision (migrates older
      backups) → restart → `/login`. A failure restarts on the existing data and points to the safety copy.
- [x] Automatic daily snapshot `backups/auto-<ts>.zip` after start (keep 7), once setup is complete.
- [x] Reminder after the first week if no manual backup in 14 days: "Back up now" / "Remind me later" (7 days).
- [ ] Uninstaller keeps `%APPDATA%\Invoice` (electron-builder default `deleteAppDataOnUninstall: false`) — Phase 9.
- **Result:** commands tested directly (valid backup; non-zip, other zip, newer-version and path-traversal zips all
  rejected with clear messages, nothing written). In the app: automatic backup on start; reminder shown and
  snoozed; "Back up now" through the Save dialog → zip with database, `.env`, logo; a customer added afterwards;
  restore through the Open dialog and confirmation → safety backup, restore, restart — the later customer gone,
  earlier data and logo back; a non-backup zip → "This backup can't be restored", no changes.

## D13 — Password reset ✅

- [x] `php artisan desktop:reset-password [--show]`: resets the first company's owner; the new password comes from
      `INVOICE_NEW_PASSWORD` (never the command line or logs); minimum 8 characters; clears the remember token and
      all sessions. Refuses before setup is complete.
- [x] `Invoice.exe --reset-password` opens `desktop/reset-password.html` (own preload, own sender check): shows the
      account name and email, new password + confirmation. At startup it appears before the main window; if the
      app is already open, the running instance opens it over the main window, which then returns to `/login`.
- [ ] Start-menu shortcut "Reset Invoice password" — Phase 9 (NSIS).
- **Result:** command tested (show, too short, reset + sessions cleared). In the app: second launch with the flag
  → window over the running app; validation messages; reset → confirmation → sign-in with the new password;
  the password does not appear in any log; cold start with the flag → reset window first, cancel → app opens.

## Phase 9 — Packaging ✅

- [x] `build/php` trimmed in `fetch-php.mjs` by allow-list: `php.exe`, `php8.dll`, `license.txt`, the VC++ runtime,
      the extension DLLs `php.ini` enables (read from the file) and their DLLs. `intl` removed (its ICU data alone
      is 35 MB; unused — Crater's Docker image never had it). **79 MB → 36 MB.** If `php.ini` enables an
      extension that was pruned, the script extracts PHP again.
- [ ] Dropping unused Composer packages (AWS SDK 29 MB, Dropbox, Mockery/PHPUnit via a non-dev test package):
      not done — backend infrastructure stays (D14).
- [x] `package.json`: every frontend library moved to `devDependencies` (Vite bundles them), so `app.asar` holds
      only `desktop/**` and `package.json` (44 KB; the August build's was 58.5 MB of node_modules).
- [x] electron-builder config (`package.json` → `build`):
  - `files`: `desktop/**/*`, `package.json`.
  - `extraResources`: `build/stage/app` → `resources/laravel` (not `resources/app`: Electron looks for its own
    code there before `app.asar`), `build/php` → `resources/php`.
  - `win.icon`: `build/icon.png` (512×512, from `public/favicons`); electron-builder converts it.
  - `nsis`: assisted installer, per-user, changeable directory, desktop + Start-menu shortcuts,
    `deleteAppDataOnUninstall: false` (data in `%APPDATA%\Invoice\data` survives uninstall and upgrades).
  - `electronLanguages: ['en-US']` (Chromium's own UI strings; 49 MB of other locales dropped),
    `compression: maximum`.
- [x] `build/installer.nsh`: "Reset Invoice password" Start-menu shortcut → `Invoice.exe --reset-password` (D13),
      removed on uninstall.
- [x] Top-level `productName: "Invoice"` so the packaged app's profile/data is `%APPDATA%\Invoice` (found in Phase 10).
- [x] Scripts: `desktop:prepare` = `build` → `desktop:fetch-php` → `desktop:stage`; `desktop:build` = prepare →
      `electron-builder --win --x64`.
- [x] Dev mode: `desktop:start` runs the source tree with `build/php` and `.desktop-data` (since Phase 5).
- [x] `stage-app.mjs` retries removing the old stage (OneDrive/antivirus locks).
- [x] README rewritten for the desktop and web variants (Windows only for now).
- [ ] Code signing: ⏸ until a certificate is available (SmartScreen will warn until then). electron-builder
      logs "signing with signtool.exe" but nothing is signed without a certificate (checked).
- [ ] macOS / Linux targets: ⏸.
- **Result:** `npm run desktop:build` → `dist/Invoice Setup 1.0.0.exe` **127.4 MiB** (August: 113 MiB with no
  backend). Unpacked: Electron 234 MB exe + support files, `resources/laravel` 113 MB (vendor 90 MB),
  `resources/php` 36 MB. Packaged app (`dist/win-unpacked/Invoice.exe` with a scratch `--user-data-dir`):
  first start provisions in ~3.5 s; 3-step onboarding → dashboard; logo, customer, invoice; PDF `%PDF-1.7` with
  the logo; backup through Settings → Backup; `--reset-password` opens the reset window over the running
  app; quit leaves no `php.exe`.
- **Not yet run:** the NSIS installer itself (install, shortcuts, upgrade, uninstall) — Phase 10.

## Phase 10 — Verification 🟨

Run on a clean Windows 11 VM **with networking disabled**. ✔ = passed on the development machine
(2026-09-27, online, not clean); the full pass on a clean offline VM is still to do.

- [ ] Install without admin rights; shortcuts created; app icon correct.
      ✔ per-user install; Start menu "Invoice" + "Reset Invoice password" (`--reset-password`), Desktop
      "Invoice"; uninstall entry. Icon not visually checked.
- [ ] First run → onboarding (steps 6–8) → dashboard. ✔ installed app, data in `%APPDATA%\Invoice\data`.
- [ ] Close the app across a recurring invoice's due date → notice on next start, invoice dated correctly.
      (✔ in dev mode, D12.)
- [ ] Create customer, item, invoice, estimate, payment, expense (with receipt upload).
- [ ] Invoice/estimate/payment PDFs render with correct fonts and logo; save dialog works; print works.
      (✔ invoice PDF with logo in the packaged app, Phase 9.)
- [ ] Reports (sales, P&L, tax summary) open.
- [ ] Click through every screen with networking disabled: nothing offers email, sharing links, updates or
      online services, and nothing errors because it is offline.
- [ ] Close and reopen: all data and logos still there; still logged in. ✔ (installed app, across an upgrade).
- [ ] Launch twice: second launch focuses the first window. (✔ dev mode, Phase 5.)
- [ ] Occupy port 8765 beforehand: app falls back and works. (✔ dev mode, Phase 5.)
- [ ] Kill `php.exe` while running: app detects it and offers restart. (✔ dev mode, Phase 5.)
- [ ] Recurring invoice is generated by the scheduler while the app is open. (✔ dev mode, Phase 5.)
- [ ] Install version N+1 over N with a new migration: pre-migrate backup created, data intact.
      ✔ 1.0.0 → 1.0.1 silent upgrade (old uninstaller runs with `/KEEP_APP_DATA`): shortcuts kept,
      `pre-upgrade-1.0.0-to-1.0.1-….sqlite`, data and session intact. Not yet with a new migration.
- [ ] Backup → wipe data dir → restore: data back. (✔ restore over changed data, Phase 8.)
- [ ] Restore a backup made on another PC (different Windows user): sign-in with the backup's account works.
- [ ] "Reset Invoice password" shortcut with the app closed and with it open. ✔ open (installed shortcut);
      closed ✔ in dev mode and packaged (Phase 9).
- [ ] Uninstall: data dir remains; reinstall picks it up. ✔ uninstall removes program files, all three
      shortcuts and the uninstall entry, keeps `%APPDATA%\Invoice\data`. Reinstall not yet run.
- [ ] Install path with spaces and a OneDrive-synced user profile. (Desktop shortcut landed in the
      OneDrive-redirected Desktop ✔; custom path with spaces not tried.)
- [ ] Windows Defender doesn't quarantine `php.exe`. (Not flagged on the dev machine.)
- [x] Installer size recorded vs. baseline (Phase 9: 127.4 MiB vs 113 MiB).

**Findings from the installer test (2026-09-27):**
- **Fixed: data went to `%APPDATA%\invoice-app`.** `productName` was only under `build`, so the packaged
  app took its name from `name`. Added a top-level `productName: "Invoice"`; dev runs now use their own
  profile `%APPDATA%\Invoice (dev)` so they never share cookies or the single-instance lock with an install.
- **Install location:** a clean machine gets `%LOCALAPPDATA%\Programs\Invoice`; an upgrade reuses the
  previous location. The August build had been installed to `Programs\invoice-app`, so this machine kept that.
- **Install/upgrade is slow: ~5 min install, ~6 min upgrade** (thousands of small PHP files, scanned by
  Defender; the upgrade also removes the old files first). Uninstall ~40 s. Options for later: ship
  Laravel as one archive unpacked on first start, or prune `vendor/` tests/docs.
- Test tooling only: Git Bash rewrites `/S` to `S:/`, which starts the interactive installer; use
  `MSYS_NO_PATHCONV=1` (or PowerShell) for silent runs.
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
| PHP's built-in server handles one request at a time on Windows (`PHP_CLI_SERVER_WORKERS` is unsupported there). The UI fires parallel API calls. | Slower screens, especially PDFs. | **Largely retired in Phase 4:** natively, pages take ~60 ms, static files ~10 ms, an invoice PDF ~0.8 s. Re-check on a low-end machine in Phase 10; fallback remains `php-cgi.exe` behind a small bundled web server. |
| Crater is AGPL-3.0. Distributing the app (modified) carries source-offer obligations. | Licensing compliance. | Ship `LICENSE` (staged) and provide the corresponding source (e.g. a public repo link in the app's About/installer) before distribution. |
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
| 2026-09-26 | 3 | Data-dir support in `bootstrap/app.php`, SQLite connector (WAL, busy timeout) + foreign keys enabled, dompdf `chroot` includes storage, system file disks use current paths, `/storage` route, `desktop:provision`. Verified with read-only code in Docker; Pest 248/248. |
| 2026-09-26 | 4 | Pinned PHP 8.1.34 + php.ini + app-local VC++ runtime (`desktop:fetch-php`), staged app with `--no-dev` Composer install (`desktop:stage`). Fixed IdeHelper provider and Windows cache-path bugs. Staged app verified natively on Windows end to end. |
| 2026-09-26 | 5 | New Electron main process (`desktop/main.js`, `runtime.js`, `log.js`, `splash.html`): data dir + `.env`, pre-upgrade backups, provisioning, PHP server with orphan/port/crash handling, per-minute scheduler, sandboxed windows, downloads. PDF response fix. Verified in dev mode (see Phase 5 result). D11 locked; D12 raised. |
| 2026-09-26 | 6 | First-run flow: provisioning seeds and completes installer steps 1–5; wizard opens at the account step and signs itself in when resuming. Verified through all three steps to the dashboard. |
| 2026-09-26 | D12 | Recurring invoice catch-up at launch (`last_run_at`, occurrence-dated invoices, notice), scheduler de-duplication, `next_invoice_at` fix. Verified incl. limits and re-launch. |
| 2026-09-26 | 7 | `APP_MODE=desktop`: online-only menus and actions hidden (updater, modules, exchange-rate providers, portal, email, cloud disks, Crater backup), Stripe package removed, 3-step installer progress. Backends untouched (D14). D13 raised. |
| 2026-09-27 | 8 | Backup/restore (`desktop:backup`, `desktop:restore`, Settings → Backup page via a preload bridge), pre-restore safety copies, daily automatic snapshots, backup reminder. Verified end to end in the app. |
| 2026-09-27 | D13 | Password reset window (`--reset-password`, `desktop:reset-password`). Verified from a running and a closed app. Start-menu shortcut left for Phase 9. |
| 2026-09-27 | 9 | Installer builds with `npm run desktop:build` (127.4 MiB): trimmed PHP (79→36 MB), no node_modules in app.asar, Laravel as resources/laravel, per-user NSIS with the reset shortcut, en-US Chromium locale only. Packaged app verified from dist/win-unpacked. README updated. |
| 2026-09-27 | 10 | Installer tested on the dev machine: install, shortcuts, onboarding, reset shortcut, 1.0.0→1.0.1 upgrade with pre-upgrade backup, uninstall keeping data. Fixed the packaged profile/data folder (`productName`), separated the dev profile. Test data removed afterwards. Clean offline VM pass still to do. |
