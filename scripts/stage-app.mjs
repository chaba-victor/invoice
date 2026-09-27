// Copies the runtime parts of the Laravel app into build/stage/app and installs production
// Composer dependencies there with the bundled PHP. Run `npm run build` and
// `node scripts/fetch-php.mjs` first.
// Usage: node scripts/stage-app.mjs

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const COMPOSER = {
  version: '2.10.3',
  sha256: '7a2d379d5b8ffdaa028580ef26494c36d2feef4b178d3dd1473a4dbc5e17c8d6',
}

// Everything the app reads at runtime. Frontend sources are left out: Vite has already bundled
// them into public/build. resources/scripts/locales stays because Laravel loads UI translations from it.
const INCLUDE = [
  'app',
  'bootstrap',
  'config',
  'database',
  'public',
  'resources/lang',
  'resources/scripts/locales',
  'resources/static',
  'resources/views',
  'routes',
  'artisan',
  'server.php',
  'composer.json',
  'composer.lock',
  'LICENSE',
]

// Paths (relative to the project root, forward slashes) skipped inside the included directories.
const EXCLUDE = [
  /^bootstrap\/cache\/.+\.php$/,
  /^public\/storage$/,
  /^public\/hot$/,
  /^public\/\.htaccess$/,
  /^public\/web\.config$/,
  /(^|\/)\.gitignore$/,
  /(^|\/)\.gitkeep$/,
]

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const stageDir = path.join(root, 'build', 'stage', 'app')
const phpDir = path.join(root, 'build', 'php')
const composerPath = path.join(root, 'build', 'cache', `composer-${COMPOSER.version}.phar`)

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function php(args, cwd) {
  execFileSync(
    path.join(phpDir, 'php.exe'),
    ['-c', path.join(phpDir, 'php.ini'), '-d', `extension_dir=${path.join(phpDir, 'ext')}`, ...args],
    { cwd, stdio: 'inherit' }
  )
}

async function ensureComposer() {
  if (fs.existsSync(composerPath) && sha256(composerPath) === COMPOSER.sha256) {
    return
  }

  console.log(`Downloading Composer ${COMPOSER.version}`)
  const res = await fetch(`https://getcomposer.org/download/${COMPOSER.version}/composer.phar`)
  if (!res.ok) {
    throw new Error(`Composer download failed: HTTP ${res.status}`)
  }
  fs.mkdirSync(path.dirname(composerPath), { recursive: true })
  fs.writeFileSync(composerPath, Buffer.from(await res.arrayBuffer()))

  const actual = sha256(composerPath)
  if (actual !== COMPOSER.sha256) {
    fs.rmSync(composerPath)
    throw new Error(`Checksum mismatch for composer.phar: expected ${COMPOSER.sha256}, got ${actual}`)
  }
}

function copyApp() {
  // Retries cover brief locks from OneDrive sync or antivirus scanners on Windows.
  fs.rmSync(stageDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })

  for (const entry of INCLUDE) {
    const from = path.join(root, entry)
    if (!fs.existsSync(from)) {
      throw new Error(`Missing ${entry}`)
    }
    fs.cpSync(from, path.join(stageDir, entry), {
      recursive: true,
      filter: (src) => {
        const rel = path.relative(root, src).split(path.sep).join('/')
        return !EXCLUDE.some((pattern) => pattern.test(rel))
      },
    })
  }
}

function dirSize(dir) {
  let total = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    total += entry.isDirectory() ? dirSize(full) : fs.statSync(full).size
  }
  return total
}

async function main() {
  if (!fs.existsSync(path.join(phpDir, 'php.exe'))) {
    throw new Error('build/php is missing. Run node scripts/fetch-php.mjs first.')
  }
  if (!fs.existsSync(path.join(root, 'public', 'build', 'manifest.json'))) {
    throw new Error('public/build is missing. Run npm run build first.')
  }

  await ensureComposer()

  console.log('Copying app to build/stage/app')
  copyApp()

  console.log('Installing production dependencies')
  // --no-scripts: the only script is package:discover, which Laravel runs itself on first boot
  // (into the user's data directory).
  php(
    [
      composerPath,
      'install',
      '--no-dev',
      '--no-scripts',
      '--no-interaction',
      '--no-progress',
      '--prefer-dist',
      '--classmap-authoritative',
    ],
    stageDir
  )

  php([composerPath, 'check-platform-reqs', '--no-dev', '--no-interaction'], stageDir)

  console.log(`Staged app: ${(dirSize(stageDir) / 1024 / 1024).toFixed(1)} MiB`)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
