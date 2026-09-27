// Runs the bundled PHP: prepares the data directory, provisions the Laravel app,
// serves it on 127.0.0.1 and runs the scheduler while the app is open.

const { spawn, execFileSync } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const net = require('net')
const path = require('path')
const log = require('./log')

// D10: a fixed port keeps the origin (and so the login session) stable; the rest are fallbacks.
const PORTS = Array.from({ length: 20 }, (_, i) => 8765 + i)
const KEEP_UPGRADE_BACKUPS = 5
const KEEP_RESTORE_BACKUPS = 5
const KEEP_AUTO_BACKUPS = 7
const AUTO_BACKUP_INTERVAL_MS = 20 * 60 * 60 * 1000
const SERVER_START_TIMEOUT_MS = 30000

function createRuntime({ appDir, phpDir, dataDir, version, dev, onServerExit }) {
  const files = {
    env: path.join(dataDir, '.env'),
    db: path.join(dataDir, 'database.sqlite'),
    logs: path.join(dataDir, 'storage', 'logs'),
    backups: path.join(dataDir, 'backups'),
    cache: path.join(dataDir, 'cache'),
    pid: path.join(dataDir, 'php-server.pid'),
    state: path.join(dataDir, 'desktop-state.json'),
  }

  let port = null
  let server = null
  let stopping = false
  let schedulerTimer = null
  let schedulerRunning = false

  const origin = () => `http://127.0.0.1:${port}`

  function phpArgs(extra) {
    return [
      '-c', path.join(phpDir, 'php.ini'),
      // Must be absolute: Windows PHP otherwise looks in C:\php\ext or resolves against the cwd.
      '-d', `extension_dir=${path.join(phpDir, 'ext')}`,
      '-d', `error_log=${path.join(files.logs, 'php.log')}`,
      ...(dev ? ['-d', 'opcache.validate_timestamps=1'] : []),
      ...extra,
    ]
  }

  // Everything derived from paths or the port is passed per process rather than written to .env,
  // so a changed port or a moved data directory needs no .env edits. Laravel's env loading is
  // immutable, so these take precedence over .env.
  function phpEnv() {
    return {
      ...process.env,
      INVOICE_DATA_DIR: dataDir,
      INVOICE_APP_VERSION: version,
      // Hides online-only features (see config/crater.php).
      APP_MODE: 'desktop',
      APP_ENV: 'production',
      APP_DEBUG: dev ? 'true' : 'false',
      APP_URL: origin(),
      SANCTUM_STATEFUL_DOMAINS: `127.0.0.1:${port}`,
      DB_CONNECTION: 'sqlite',
      DB_DATABASE: files.db,
      CACHE_DRIVER: 'file',
      SESSION_DRIVER: 'file',
      QUEUE_CONNECTION: 'sync',
      BROADCAST_DRIVER: 'log',
      LOG_CHANNEL: 'daily',
      // D8: no email in the offline app.
      MAIL_DRIVER: 'log',
      MAIL_MAILER: 'log',
    }
  }

  function spawnPhp(args, extraEnv = {}) {
    return spawn(path.join(phpDir, 'php.exe'), phpArgs(args), {
      cwd: appDir,
      env: { ...phpEnv(), ...extraEnv },
      windowsHide: true,
    })
  }

  function pipeLines(stream, onLine) {
    let buffered = ''
    stream.on('data', (chunk) => {
      buffered += chunk.toString()
      const lines = buffered.split(/\r?\n/)
      buffered = lines.pop()
      lines.filter((l) => l.trim()).forEach(onLine)
    })
    stream.on('end', () => buffered.trim() && onLine(buffered))
  }

  function artisan(args, { quiet, env } = {}) {
    return new Promise((resolve, reject) => {
      const label = args[0]
      const output = []
      const proc = spawnPhp(['artisan', ...args, '--no-ansi'], env)

      const onLine = (line) => {
        output.push(line)
        if (!quiet || !quiet.test(line)) {
          log.info(`[${label}] ${line}`)
        }
      }
      pipeLines(proc.stdout, onLine)
      pipeLines(proc.stderr, onLine)

      proc.on('error', reject)
      proc.on('close', (code) => {
        if (code === 0) {
          resolve(output)
        } else {
          const err = new Error(`php artisan ${args.join(' ')} exited with code ${code}\n${output.slice(-15).join('\n')}`)
          err.output = output
          reject(err)
        }
      })
    })
  }

  // The desktop:* commands print one "DESKTOP_REPORT {json}" line describing the outcome.
  function parseReport(output) {
    const line = (output || []).find((l) => l.startsWith('DESKTOP_REPORT '))
    try {
      return line ? JSON.parse(line.slice('DESKTOP_REPORT '.length)) : {}
    } catch (err) {
      log.error('Could not read a command report', err)
      return {}
    }
  }

  // Runs a desktop:* command and returns its report, including for failures it reported itself.
  async function artisanReport(args, options) {
    try {
      return parseReport(await artisan(args, options))
    } catch (err) {
      const report = parseReport(err.output)
      if (report.error) {
        return report
      }
      throw err
    }
  }

  function readState() {
    try {
      return JSON.parse(fs.readFileSync(files.state, 'utf8'))
    } catch (err) {
      return {}
    }
  }

  function writeState(changes) {
    const state = { ...readState(), ...changes }
    fs.writeFileSync(files.state, JSON.stringify(state, null, 2))
    return state
  }

  function ensureDataDir() {
    fs.mkdirSync(files.logs, { recursive: true })

    if (!fs.existsSync(files.env)) {
      const key = crypto.randomBytes(32).toString('base64')
      fs.writeFileSync(
        files.env,
        [
          '# Created by the Invoice desktop app on first run.',
          '# Paths, port and drivers are supplied by the app at launch; see desktop/runtime.js.',
          `APP_KEY=base64:${key}`,
          '',
        ].join('\n')
      )
      log.info('Created .env with a new APP_KEY')
    }
  }

  function killProcessTree(pid) {
    try {
      if (process.platform === 'win32') {
        execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      } else {
        process.kill(pid)
      }
    } catch (err) {
      // Already gone.
    }
  }

  // A crash of the Electron process leaves php.exe running and holding the port.
  function killOrphanServer() {
    let pid
    try {
      pid = parseInt(fs.readFileSync(files.pid, 'utf8'), 10)
    } catch (err) {
      return
    }

    if (pid && process.platform === 'win32') {
      try {
        const task = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true }).toString()
        // Only kill it if the PID still belongs to php.exe, not a reused PID.
        if (/^"php\.exe"/i.test(task.trim())) {
          log.info(`Stopping orphaned PHP server (PID ${pid})`)
          killProcessTree(pid)
        }
      } catch (err) {
        log.error('Could not check orphaned PHP server', err)
      }
    }

    fs.rmSync(files.pid, { force: true })
  }

  function isPortFree(candidate) {
    return new Promise((resolve) => {
      const probe = net.createServer()
      probe.once('error', () => resolve(false))
      probe.once('listening', () => probe.close(() => resolve(true)))
      probe.listen(candidate, '127.0.0.1')
    })
  }

  async function pickPort() {
    for (const candidate of PORTS) {
      if (await isPortFree(candidate)) {
        return candidate
      }
    }
    throw new Error(`No free port between ${PORTS[0]} and ${PORTS[PORTS.length - 1]}`)
  }

  // Migrations only change with a new app version, so back up the database before the first
  // start of a new version. Keeps the last few such backups.
  function backupBeforeUpgrade() {
    const previous = readState().version || 'unknown'
    if (!fs.existsSync(files.db) || previous === version) {
      return
    }

    fs.mkdirSync(files.backups, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const name = `pre-upgrade-${previous}-to-${version}-${stamp}.sqlite`

    fs.copyFileSync(files.db, path.join(files.backups, name))
    // After a crash, committed data may still sit in the WAL file.
    if (fs.existsSync(files.db + '-wal')) {
      fs.copyFileSync(files.db + '-wal', path.join(files.backups, name + '-wal'))
    }
    log.info(`Backed up database to backups/${name}`)

    const backups = fs
      .readdirSync(files.backups)
      .filter((f) => /^pre-upgrade-.*\.sqlite$/.test(f))
      .sort()
    for (const old of backups.slice(0, Math.max(0, backups.length - KEEP_UPGRADE_BACKUPS))) {
      fs.rmSync(path.join(files.backups, old), { force: true })
      fs.rmSync(path.join(files.backups, old + '-wal'), { force: true })
    }
  }

  async function prepare(onStatus = () => {}) {
    onStatus('Preparing your data…')
    ensureDataDir()
    killOrphanServer()

    port = await pickPort()
    log.info(`Using ${origin()}`)

    // A cached config would pin the previous port and paths; provisioning rebuilds it.
    for (const cached of ['config.php', 'routes-v7.php']) {
      fs.rmSync(path.join(files.cache, cached), { force: true })
    }

    backupBeforeUpgrade()

    onStatus('Updating the database…')
    const output = await artisan(['desktop:provision'])

    const now = new Date().toISOString()
    writeState({ version, lastStartedAt: now, firstStartedAt: readState().firstStartedAt || now })

    return parseReport(output)
  }

  function waitForServer(proc) {
    const deadline = Date.now() + SERVER_START_TIMEOUT_MS

    return new Promise((resolve, reject) => {
      let exited = false
      proc.once('exit', (code) => {
        exited = true
        reject(new Error(`PHP server exited during startup with code ${code}`))
      })

      const attempt = () => {
        if (exited) return
        const req = http.get(`${origin()}/login`, (res) => {
          res.resume()
          if (res.statusCode < 500) {
            resolve()
          } else {
            reject(new Error(`PHP server answered HTTP ${res.statusCode} during startup`))
          }
        })
        req.on('error', () => {
          if (Date.now() > deadline) {
            reject(new Error('PHP server did not start within 30 seconds'))
          } else {
            setTimeout(attempt, 250)
          }
        })
        req.setTimeout(5000, () => req.destroy())
      }
      attempt()
    })
  }

  async function startServer() {
    stopping = false
    const proc = spawnPhp(['-S', `127.0.0.1:${port}`, '-t', 'public', 'server.php'])
    server = proc
    fs.writeFileSync(files.pid, String(proc.pid))

    // The built-in server logs every request to stderr; keep only what isn't routine.
    const routine = /(Accepted|Closing)$|\[[123]\d\d\]: (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) /
    const onLine = (line) => !routine.test(line) && log.info(`[php-server] ${line}`)
    pipeLines(proc.stdout, onLine)
    pipeLines(proc.stderr, onLine)

    proc.on('exit', (code, signal) => {
      if (server === proc) {
        server = null
      }
      fs.rmSync(files.pid, { force: true })
      if (!stopping) {
        log.error(`PHP server exited unexpectedly (code ${code}, signal ${signal})`)
        onServerExit && onServerExit(code)
      }
    })

    await waitForServer(proc)
    log.info(`PHP server ready (PID ${proc.pid})`)
  }

  function stopServer() {
    stopping = true
    if (server) {
      killProcessTree(server.pid)
      server = null
    }
    fs.rmSync(files.pid, { force: true })
  }

  // Laravel's scheduler decides what is due from the current minute, so run it once per
  // minute, just after the minute starts, and never twice in the same minute.
  function startScheduler() {
    const scheduleNext = () => {
      const delay = 60000 - (Date.now() % 60000) + 1000
      schedulerTimer = setTimeout(tick, delay)
    }

    const tick = async () => {
      if (!schedulerRunning && server) {
        schedulerRunning = true
        try {
          await artisan(['schedule:run'], { quiet: /No scheduled commands are ready to run/ })
        } catch (err) {
          log.error('Scheduler run failed', err)
        } finally {
          schedulerRunning = false
        }
      }
      scheduleNext()
    }

    scheduleNext()
  }

  function stopScheduler() {
    clearTimeout(schedulerTimer)
    schedulerTimer = null
  }

  function timestamp() {
    return new Date().toISOString().replace(/[:.]/g, '-')
  }

  function pruneBackups(prefix, keep) {
    const found = fs
      .readdirSync(files.backups)
      .filter((f) => f.startsWith(prefix) && f.endsWith('.zip'))
      .sort()
    for (const old of found.slice(0, Math.max(0, found.length - keep))) {
      fs.rmSync(path.join(files.backups, old), { force: true })
    }
  }

  // Backups are zips written by `php artisan desktop:backup` (app/Console/Commands/DesktopBackup.php).
  async function createBackup(target) {
    const report = await artisanReport(['desktop:backup', target])
    if (!report.ok) {
      throw new Error(report.error || 'The backup could not be written.')
    }
    return report
  }

  async function inspectBackup(file) {
    const report = await artisanReport(['desktop:restore', file, '--inspect'])
    if (!report.ok) {
      throw new Error(report.error || 'This file could not be read.')
    }
    return report.manifest
  }

  // Replaces all data with a backup; the server and scheduler must be stopped first. The current
  // data is saved to backups/ beforehand. Returns the provisioning report for the restored data.
  async function restoreBackup(file, onStatus = () => {}) {
    onStatus('Saving a copy of your current data…')
    fs.mkdirSync(files.backups, { recursive: true })
    const safety = path.join(files.backups, `pre-restore-${timestamp()}.zip`)
    await createBackup(safety)
    pruneBackups('pre-restore-', KEEP_RESTORE_BACKUPS)

    onStatus('Restoring your backup…')
    const report = await artisanReport(['desktop:restore', file])
    if (!report.ok) {
      throw new Error(report.error || 'The backup could not be restored.')
    }
    log.info(`Restored ${file}; the previous data is in backups/${path.basename(safety)}`)

    return prepare(onStatus)
  }

  // A daily snapshot kept on this computer. It protects against mistakes and a damaged database,
  // not against losing the computer; that's what the backup reminder is for.
  async function autoBackup() {
    if (Date.now() - Date.parse(readState().lastAutoBackupAt || 0) < AUTO_BACKUP_INTERVAL_MS) {
      return
    }
    fs.mkdirSync(files.backups, { recursive: true })
    const target = path.join(files.backups, `auto-${timestamp()}.zip`)
    await createBackup(target)
    writeState({ lastAutoBackupAt: new Date().toISOString() })
    pruneBackups('auto-', KEEP_AUTO_BACKUPS)
    log.info(`Automatic backup written to backups/${path.basename(target)}`)
  }

  // D13: password reset for the owner account (app/Console/Commands/DesktopResetPassword.php).
  async function getOwnerAccount() {
    return artisanReport(['desktop:reset-password', '--show'])
  }

  async function resetPassword(password) {
    // Passed in the environment, never on the command line.
    return artisanReport(['desktop:reset-password'], { env: { INVOICE_NEW_PASSWORD: password } })
  }

  return {
    prepare,
    startServer,
    getOwnerAccount,
    resetPassword,
    stopServer,
    startScheduler,
    stopScheduler,
    createBackup,
    inspectBackup,
    restoreBackup,
    autoBackup,
    readState,
    writeState,
    get origin() {
      return port ? origin() : null
    },
    logsDir: files.logs,
    backupsDir: files.backups,
  }
}

module.exports = { createRuntime }
