const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } = require('electron')
const fs = require('fs')
const path = require('path')
const log = require('./log')
const { createRuntime } = require('./runtime')

const dev = !app.isPackaged
const root = path.resolve(__dirname, '..')

// Packaged: code and PHP ship as read-only resources; data lives per user. Electron keeps its own
// Chromium data (including a "Cache" folder) in userData, so the app's data gets a subfolder.
// Dev: the source tree, build/php and a local .desktop-data folder.
const paths = dev
  ? {
      appDir: root,
      phpDir: path.join(root, 'build', 'php'),
      dataDir: path.join(root, '.desktop-data'),
    }
  : {
      // Not "app": Electron looks for its own code in resources/app before app.asar.
      appDir: path.join(process.resourcesPath, 'laravel'),
      phpDir: path.join(process.resourcesPath, 'php'),
      dataDir: path.join(app.getPath('userData'), 'data'),
    }

const icon = path.join(paths.appDir, 'public', 'favicons', 'android-chrome-512x512.png')

const webPreferences = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  spellcheck: true,
}

let runtime = null
let mainWindow = null
let splash = null
let quitting = false

function isAppUrl(url) {
  try {
    return runtime && runtime.origin && new URL(url).origin === runtime.origin
  } catch (err) {
    return false
  }
}

function openExternal(url) {
  try {
    if (['https:', 'http:', 'mailto:'].includes(new URL(url).protocol)) {
      shell.openExternal(url)
      return
    }
  } catch (err) {
    // Not a URL.
  }
  log.info(`Blocked opening ${url}`)
}

function createSplash() {
  const win = new BrowserWindow({
    width: 420,
    height: 260,
    frame: false,
    resizable: false,
    center: true,
    show: false,
    icon,
    webPreferences,
  })
  win.loadFile(path.join(__dirname, 'splash.html'))
  win.once('ready-to-show', () => win.show())
  return win
}

function setSplashStatus(text) {
  if (splash && !splash.isDestroyed()) {
    splash.webContents.executeJavaScript(`setStatus(${JSON.stringify(text)})`).catch(() => {})
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Invoice',
    show: false,
    icon,
    autoHideMenuBar: true,
    // Only the main window gets the desktop bridge (backup and restore).
    webPreferences: { ...webPreferences, preload: path.join(__dirname, 'preload.js') },
  })

  // Some pages have no <title>, which would put the raw local URL in the title bar.
  mainWindow.on('page-title-updated', (event) => event.preventDefault())

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    if (splash && !splash.isDestroyed()) {
      splash.close()
    }
  })

  // PDF previews open in child windows; closing the main window ends the app.
  mainWindow.on('closed', () => {
    mainWindow = null
    app.quit()
  })

  mainWindow.loadURL(`${runtime.origin}/admin/dashboard`)
}

// Applies to every page the app shows: the main window, PDF windows and the splash.
function secureWebContents(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { width: 1000, height: 800, icon, autoHideMenuBar: true, webPreferences },
      }
    }
    openExternal(url)
    return { action: 'deny' }
  })

  contents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault()
      openExternal(url)
    }
  })

  contents.on('will-attach-webview', (event) => event.preventDefault())
}

function configureSession() {
  const ses = session.defaultSession

  // Copying links to the clipboard is the only browser permission the app uses.
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(permission === 'clipboard-sanitized-write' && isAppUrl(details.requestingUrl))
  })
  ses.setPermissionCheckHandler((contents, permission, requestingOrigin) => {
    return permission === 'clipboard-sanitized-write' && isAppUrl(requestingOrigin)
  })

  // Downloads (PDFs, reports) always ask where to save.
  ses.on('will-download', (event, item, contents) => {
    item.setSaveDialogOptions({ defaultPath: path.join(app.getPath('downloads'), item.getFilename()) })

    const win = BrowserWindow.fromWebContents(contents)
    item.once('done', (e, state) => {
      log.info(`Download ${item.getFilename()}: ${state}`)
      // A download opened with window.open leaves an empty child window behind.
      if (win && win !== mainWindow && !win.isDestroyed() && ['', 'about:blank'].includes(contents.getURL())) {
        win.close()
      }
    })
  })
}

const DAY_MS = 24 * 60 * 60 * 1000

let resetWindow = null

const wantsPasswordReset = (argv) => argv.includes('--reset-password')

// D13: the "Reset Invoice password" shortcut runs Invoice.exe --reset-password, which opens
// this window. Resolves once it closes.
function openResetPasswordWindow() {
  if (resetWindow) {
    resetWindow.focus()
    return Promise.resolve()
  }

  resetWindow = new BrowserWindow({
    width: 480,
    height: 540,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'Reset Invoice password',
    icon,
    parent: mainWindow || undefined,
    modal: Boolean(mainWindow),
    webPreferences: { ...webPreferences, preload: path.join(__dirname, 'reset-preload.js') },
  })
  resetWindow.setMenu(null)
  resetWindow.loadFile(path.join(__dirname, 'reset-password.html'))

  return new Promise((resolve) =>
    resetWindow.on('closed', () => {
      resetWindow = null
      resolve()
    })
  )
}

// Asks where to save a backup and writes it. Used by Settings → Backup and the reminder.
async function backupNow() {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save backup',
    defaultPath: path.join(app.getPath('documents'), `Invoice backup ${new Date().toISOString().slice(0, 10)}.zip`),
    filters: [{ name: 'Invoice backup', extensions: ['zip'] }],
  })
  if (canceled || !filePath) {
    return { canceled: true }
  }

  try {
    const result = await runtime.createBackup(filePath)
    runtime.writeState({ lastBackupAt: new Date().toISOString() })
    log.info(`Backup saved to ${filePath}`)
    return { ok: true, path: filePath, size: result.size }
  } catch (err) {
    log.error('Backup failed', err)
    return { ok: false, error: err.message }
  }
}

// Replaces all data with a backup chosen by the user, after checking it and asking to confirm.
async function restoreFromBackup() {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Restore from backup',
    filters: [{ name: 'Invoice backup', extensions: ['zip'] }],
    properties: ['openFile'],
  })
  if (canceled || !filePaths.length) {
    return { canceled: true }
  }
  const file = filePaths[0]

  let manifest
  try {
    manifest = await runtime.inspectBackup(file)
  } catch (err) {
    await dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'Invoice',
      message: "This backup can't be restored.",
      detail: err.message,
      noLink: true,
    })
    return { ok: false, error: err.message }
  }

  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Invoice',
    message: 'Replace all current data with this backup?',
    detail: [
      `Backup made ${new Date(manifest.created_at).toLocaleString()}`,
      `Company: ${(manifest.companies || []).join(', ') || '—'}`,
      `Invoices: ${manifest.invoices}`,
      '',
      'Your current data is saved to the backups folder first. Invoice then restarts; if you are asked to sign in, use the account from the backup.',
    ].join('\n'),
    buttons: ['Restore', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  })
  if (response !== 0) {
    return { canceled: true }
  }

  runtime.stopScheduler()
  runtime.stopServer()
  mainWindow.hide()
  splash = createSplash()

  let restoreError = null
  try {
    await runtime.restoreBackup(file, setSplashStatus)
  } catch (err) {
    restoreError = err
    log.error('Restore failed', err)
  }

  try {
    await runtime.startServer()
    runtime.startScheduler()
  } catch (err) {
    await showFatalError('Invoice could not restart after restoring.', err)
    app.quit()
    return { ok: false }
  }

  mainWindow.loadURL(`${runtime.origin}/login`)
  mainWindow.show()
  splash.close()

  if (restoreError) {
    await dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'Invoice',
      message: 'The backup could not be restored.',
      detail: `${restoreError.message}\n\nA copy of the data from before the restore is in the backups folder.`,
      noLink: true,
    })
    return { ok: false, error: restoreError.message }
  }
  return { ok: true }
}

// Nudges towards a backup kept somewhere else: after the first week, if none in two weeks.
async function remindToBackUp(setupComplete) {
  const state = runtime.readState()
  const now = Date.now()
  if (
    !setupComplete ||
    now - Date.parse(state.firstStartedAt || new Date(now).toISOString()) < 7 * DAY_MS ||
    (state.lastBackupAt && now - Date.parse(state.lastBackupAt) < 14 * DAY_MS) ||
    (state.backupReminderSnoozedUntil && now < Date.parse(state.backupReminderSnoozedUntil))
  ) {
    return
  }

  const days = state.lastBackupAt ? Math.floor((now - Date.parse(state.lastBackupAt)) / DAY_MS) : null
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Invoice',
    message: days === null ? "You haven't saved a backup yet." : `Your last backup was ${days} days ago.`,
    detail:
      'Your data is stored only on this computer. Save a backup to a USB drive or a cloud folder so you can recover it if this computer is lost or stops working.',
    buttons: ['Back up now', 'Remind me later'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  })

  if (response === 0 && (await backupNow()).ok) {
    return
  }
  runtime.writeState({ backupReminderSnoozedUntil: new Date(now + 7 * DAY_MS).toISOString() })
}

function registerDesktopBridge() {
  // Only the main window, showing the local app, may use the bridge.
  const handle = (channel, fn) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (!mainWindow || event.sender !== mainWindow.webContents || !isAppUrl(event.senderFrame.url)) {
        throw new Error('Not allowed')
      }
      return fn(...args)
    })

  // The password reset window has its own bridge (reset-preload.js) and sender check.
  const handleReset = (channel, fn) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (!resetWindow || event.sender !== resetWindow.webContents) {
        throw new Error('Not allowed')
      }
      return fn(...args)
    })

  handleReset('reset:account', () => runtime.getOwnerAccount())
  handleReset('reset:submit', async (password) => {
    const result = await runtime.resetPassword(String(password))
    if (result.ok) {
      log.info('Owner password reset')
      // The reset signs everyone out.
      if (mainWindow) {
        mainWindow.loadURL(`${runtime.origin}/login`)
      }
    }
    return result
  })
  handleReset('reset:close', () => resetWindow && resetWindow.close())

  handle('backup:info', () => {
    const state = runtime.readState()
    return { lastBackupAt: state.lastBackupAt || null, lastAutoBackupAt: state.lastAutoBackupAt || null }
  })
  handle('backup:create', backupNow)
  handle('backup:restore', restoreFromBackup)
  handle('backup:open-folder', () => {
    fs.mkdirSync(runtime.backupsDir, { recursive: true })
    return shell.openPath(runtime.backupsDir)
  })
}

// D12: tell the user which recurring invoices were created for occurrences missed while closed.
async function showMissedRecurringInvoices(missed) {
  const invoices = (missed && missed.invoices) || []
  const capped = (missed && missed.capped) || []
  if (!invoices.length && !capped.length) {
    return
  }

  const shown = invoices.slice(0, 10).map((i) => `${i.invoice_number} · ${i.customer || 'Unknown customer'} · ${i.invoice_date}`)
  if (invoices.length > shown.length) {
    shown.push(`…and ${invoices.length - shown.length} more`)
  }
  if (capped.length) {
    shown.push('', 'Some schedules had more missed dates than can be created at once; the rest will be created the next time Invoice starts.')
  }

  const count = invoices.length
  await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Invoice',
    message: `While Invoice was closed, ${count} recurring invoice${count === 1 ? ' was' : 's were'} due.`,
    detail: `${count === 1 ? 'It has' : 'They have'} been created as drafts, dated when they were due:\n\n${shown.join('\n')}`,
    buttons: ['OK'],
    noLink: true,
  })
}

async function showFatalError(message, err) {
  log.error(message, err)
  const { response } = await dialog.showMessageBox({
    type: 'error',
    title: 'Invoice',
    message,
    detail: `${err && err.message ? err.message : err}\n\nThe log file has more detail: ${log.file}`,
    buttons: ['Open log folder', 'Quit'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  })
  if (response === 0) {
    await shell.openPath(runtime ? runtime.logsDir : path.dirname(log.file))
  }
}

async function onServerExit(code) {
  // During startup, start() reports the failure.
  if (quitting || !mainWindow) {
    return
  }

  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'error',
    title: 'Invoice',
    message: "Invoice's local server stopped unexpectedly.",
    detail: `Exit code ${code}. Your data is safe; restart to continue.\n\nLog: ${log.file}`,
    buttons: ['Restart', 'Quit'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  })

  if (response !== 0) {
    app.quit()
    return
  }

  try {
    await runtime.startServer()
    mainWindow.reload()
  } catch (err) {
    await showFatalError('Invoice could not restart its local server.', err)
    app.quit()
  }
}

async function start() {
  log.init(path.join(paths.dataDir, 'storage', 'logs'))
  log.info(`Invoice ${app.getVersion()} starting${dev ? ' (dev)' : ''}`, paths)

  if (!dev) {
    Menu.setApplicationMenu(null)
  }

  configureSession()
  splash = createSplash()

  runtime = createRuntime({ ...paths, version: app.getVersion(), dev, onServerExit })

  try {
    const report = await runtime.prepare(setSplashStatus)
    setSplashStatus('Starting…')
    await runtime.startServer()
    runtime.startScheduler()
    registerDesktopBridge()

    if (wantsPasswordReset(process.argv)) {
      await openResetPasswordWindow()
    }

    createMainWindow()

    mainWindow.once('ready-to-show', async () => {
      await showMissedRecurringInvoices(report.missedRecurringInvoices)
      await remindToBackUp(report.setupComplete)
    })

    if (report.setupComplete) {
      runtime.autoBackup().catch((err) => log.error('Automatic backup failed', err))
    }
  } catch (err) {
    // The splash stays open behind the dialog: closing the last window would quit the app first.
    await showFatalError('Invoice could not start.', err)
    app.quit()
  }
}

if (!app.requestSingleInstanceLock()) {
  // Another instance owns the data directory and the server; it focuses itself.
  app.quit()
} else {
  app.on('second-instance', (event, argv) => {
    if (wantsPasswordReset(argv) && mainWindow) {
      openResetPasswordWindow()
      return
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.on('web-contents-created', (event, contents) => secureWebContents(contents))

  app.on('before-quit', () => {
    quitting = true
    if (runtime) {
      runtime.stopScheduler()
      runtime.stopServer()
    }
  })

  app.on('window-all-closed', () => app.quit())

  app.whenReady().then(start)
}
