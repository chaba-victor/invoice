# Invoice - Invoicing & Accounting

Invoice tracks customers, items, estimates, invoices, recurring invoices, payments and expenses, and produces PDF invoices, estimates, receipts and reports. It is based on [Crater](https://github.com/crater-invoice/crater) (Laravel 8 + Vue 3).

It runs two ways from the same code:

* **Desktop app (Windows)** — installs like any Windows program and works fully offline. It bundles its own PHP and keeps all data in a local SQLite database.
* **Web app** — a regular server install (Docker setup below), with email, the customer portal and the other online features.

---

## 💻 Desktop App

### What it includes

* No internet, server or Docker needed. The installer contains Electron, a portable PHP 8.1 and the Laravel app.
* Data lives in `%APPDATA%\Invoice\data` (database, logos, receipts, backups) and is kept when the app is uninstalled or updated.
* **Settings → Backup** saves a backup file and restores one. A copy is also saved automatically once a day.
* Recurring invoices that came due while the app was closed are created on the next start.
* The **Reset Invoice password** Start-menu shortcut sets a new password, since the offline app can't send reset emails.
* Features that need the internet or email (sending documents, customer portal, update checks, modules, online exchange rates, cloud storage) are hidden in the desktop app.

### Building the installer

Requirements: Windows 10/11 x64, Node.js 18+, internet access during the build (PHP and Composer packages are downloaded), and the Visual Studio 2019+ Build Tools (the build copies the Visual C++ runtime from them).

```bash
npm install
npm run desktop:build
```

This builds the frontend, downloads and trims PHP (`build/php`), stages the Laravel app with production dependencies (`build/stage/app`) and writes `dist/Invoice Setup <version>.exe`.

### Running from source

```bash
npm install
npm run build
npm run desktop:fetch-php
npm run desktop:start
```

`desktop:start` runs the app from the source tree with its data in `.desktop-data/`. The source tree needs its PHP dependencies installed in `vendor/` first (`composer install`).

See [docs/desktop-plan.md](docs/desktop-plan.md) for how the desktop app is put together and what remains to be done.

---

## 🛠️ Web App (Docker)

```bash
# 1. Clone the repository
git clone <repository-url> invoice
cd invoice

# 2. Start Docker containers
docker compose up -d

# 3. Compile frontend production assets
npm install
npm run build

# 4. Open http://localhost in your browser and follow the installer
```

---

## 📜 License

Invoice is released under the **GNU AFFERO GENERAL PUBLIC LICENSE Version 3**. See [LICENSE](LICENSE) for details. If you distribute the desktop app, you must also offer its corresponding source code.
