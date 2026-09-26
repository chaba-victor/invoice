# Invoice - Offline-First Invoicing & Accounting PWA

Invoice is a modern, open-source web, Progressive Web Application (PWA), and native desktop application designed to track expenses, payments, and create professional invoices and estimates.

---

## 🌟 Key Features

* **Offline-First Architecture**: Powered by **Dexie.js IndexedDB** and a background **Outbox Synchronization Engine**. Create Invoices, Customers, Items, and Estimates without an internet connection—all changes sync automatically when reconnected!
* **Progressive Web App (PWA)**: Install directly from Chrome, Edge, or mobile browsers as a standalone application.
* **Native Desktop App**: Packaged with **Electron** for cross-platform desktop execution (Windows, macOS, Linux).
* **Multi-Company & Custom Currency**: Track multiple business entities with custom tax rates, currencies, and localized invoice templates.
* **Payment Integration**: Stripe payment gateway support for online invoice settlement.

---

## 🚀 PWA & Offline Capabilities

The application includes full offline client-side persistence and background synchronization:

* **Local Persistence**: Invoices, Customers, Items, and Estimates are stored directly in your browser's IndexedDB.
* **Reference Data Hydration**: Reference lists (Active Customers & Line Items) are pre-fetched on application startup for instant offline availability.
* **Outbox Engine**: Offline mutations are queued safely and dispatched sequentially to the server upon network reconnection.
* **Real-time Status Badge**: Header indicator displays connection state (🟢 **Online**, 🟠 **Offline [N Pending]**, 🔵 **Syncing...**).

---

## 💻 Running as a Native Desktop App

Invoice can be run and built as a standalone desktop application using **Electron**.

### Prerequisites
Make sure you have Node.js (v16+) installed.

### Development Mode
Start the local Docker environment, then launch the Electron desktop window:
```bash
# Start local containers
docker compose up -d

# Launch desktop app window
npm run desktop:start
```

### Packaging Desktop Installers
To build standalone executable installers (`.exe` for Windows, `.dmg` for macOS, `.AppImage` for Linux):
```bash
npm run desktop:build
```

---

## 🛠️ Docker Quickstart

To run Invoice in a containerized development environment:

```bash
# 1. Clone the repository
git clone https://github.com/your-username/invoice.git
cd invoice

# 2. Start Docker containers
docker compose up -d

# 3. Compile frontend production assets
npm run build

# 4. Access application shell
# Open http://localhost in your browser
```

---

## 📜 License

Invoice is released under the **GNU AFFERO GENERAL PUBLIC LICENSE Version 3**. See [LICENSE](LICENSE) for details.
