// The installer ships the Laravel app as resources/laravel.zip: having NSIS write ~11,000 small
// files took minutes, extracting one zip takes seconds. The app runs from a copy extracted once
// per build into %LOCALAPPDATA%\Invoice\app\<hash> (local, not roaming: it's code, not data).
// The copy is never written to; the user's data stays in the data directory.

const { spawn } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const log = require('./log')

function run(command, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', (chunk) => (stderr += chunk))
    proc.on('error', reject)
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited with code ${code}: ${stderr.trim()}`))))
  })
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    fs.createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')))
  })
}

// Far faster than deleting file by file (for 11,000 files: 0.2 s rather than several seconds).
function removeDir(dir) {
  if (!fs.existsSync(dir)) {
    return Promise.resolve()
  }
  return run(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'rmdir', '/s', '/q', dir])
}

async function extract(zip, target, php) {
  // Windows' bsdtar (Windows 10 1803+) is quickest; the bundled PHP is the fallback.
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
  if (fs.existsSync(tar)) {
    return run(tar, ['-x', '-f', zip, '-C', target])
  }
  return run(php.exe, [
    '-c', php.ini,
    '-d', `extension_dir=${php.extDir}`,
    '-r', '$z = new ZipArchive(); if ($z->open($argv[1]) !== true || !$z->extractTo($argv[2])) exit(1);',
    zip,
    target,
  ])
}

// Antivirus scanners briefly lock freshly written files, which can make the rename fail.
async function renameWithRetry(from, to) {
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(from, to)
      return
    } catch (err) {
      if (attempt >= 10 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
}

function extractRoot() {
  const local = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local')
  return path.join(local, 'Invoice', 'app')
}

// Returns the directory to run the Laravel app from, extracting it first if needed.
async function ensureAppExtracted({ resourcesPath, phpDir, onStatus = () => {} }) {
  const zip = path.join(resourcesPath, 'laravel.zip')
  const info = JSON.parse(fs.readFileSync(path.join(resourcesPath, 'laravel.json'), 'utf8'))
  const target = path.join(extractRoot(), info.sha256.slice(0, 16))
  const marker = path.join(target, '.complete')

  if (fs.existsSync(marker)) {
    return target
  }

  onStatus('Preparing Invoice for first use…')
  const started = Date.now()

  if ((await sha256(zip)) !== info.sha256) {
    throw new Error(`The installed files are damaged (${zip}). Please reinstall Invoice.`)
  }

  // Extract beside the target and rename at the end, so a half-extracted copy is never used.
  const partial = `${target}.partial`
  await removeDir(partial)
  await removeDir(target)
  fs.mkdirSync(partial, { recursive: true })

  await extract(zip, partial, { exe: path.join(phpDir, 'php.exe'), ini: path.join(phpDir, 'php.ini'), extDir: path.join(phpDir, 'ext') })
  fs.writeFileSync(path.join(partial, '.complete'), `${info.sha256}\n`)
  await renameWithRetry(partial, target)

  log.info(`Extracted the app to ${target} in ${((Date.now() - started) / 1000).toFixed(1)} s`)
  return target
}

// Removes copies extracted for other builds (after an upgrade). Runs in the background.
async function removeOtherCopies(current) {
  const root = path.dirname(current)
  for (const name of fs.readdirSync(root)) {
    const dir = path.join(root, name)
    if (dir !== current) {
      await removeDir(dir).catch((err) => log.error(`Could not remove ${dir}`, err))
      log.info(`Removed old app copy ${name}`)
    }
  }
}

module.exports = { ensureAppExtracted, removeOtherCopies }
