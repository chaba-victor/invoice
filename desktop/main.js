const { app, BrowserWindow, Menu, dialog, session, shell } = require('electron')
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
      appDir: path.join(process.resourcesPath, 'app'),
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
    webPreferences,
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
    await runtime.prepare(setSplashStatus)
    setSplashStatus('Starting…')
    await runtime.startServer()
    runtime.startScheduler()
    createMainWindow()
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
  app.on('second-instance', () => {
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
