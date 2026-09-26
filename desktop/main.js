const { app, BrowserWindow, Menu } = require('electron')
const path = require('path')
const http = require('http')
const fs = require('fs')

let mainWindow

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json',
}

function startLocalServer(callback) {
  const publicDir = path.join(__dirname, '../public')

  const server = http.createServer((req, res) => {
    let reqUrl = req.url.split('?')[0]
    let filePath = path.join(publicDir, reqUrl)

    // Check if requested static file exists
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(publicDir, 'index.html')
    }

    const ext = path.extname(filePath).toLowerCase()
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'

    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.writeHead(500)
        res.end('Server Error')
      } else {
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': 'no-cache',
        })
        res.end(content, 'utf-8')
      }
    })
  })

  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port
    console.log(`Invoice Desktop Server running on http://127.0.0.1:${port}`)
    callback(`http://127.0.0.1:${port}`)
  })
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Invoice',
    icon: path.join(__dirname, '../public/favicons/android-chrome-512x512.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
  })

  // Remove standard window menu bar for clean native app appearance
  Menu.setApplicationMenu(null)

  mainWindow.loadURL(url)

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  // If DESKTOP_APP_URL is specified (e.g. running against external server), use it.
  // Otherwise start embedded local HTTP server for zero-dependency desktop execution.
  if (process.env.DESKTOP_APP_URL) {
    createWindow(process.env.DESKTOP_APP_URL)
  } else {
    startLocalServer((localUrl) => {
      createWindow(localUrl)
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (process.env.DESKTOP_APP_URL) {
        createWindow(process.env.DESKTOP_APP_URL)
      } else {
        startLocalServer((localUrl) => {
          createWindow(localUrl)
        })
      }
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
