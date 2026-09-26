// Downloads the pinned portable PHP for Windows into build/php and installs build/php.ini.
// Usage: node scripts/fetch-php.mjs [--force]

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PHP = {
  version: '8.1.34',
  file: 'php-8.1.34-nts-Win32-vs16-x64.zip',
  sha256: '9cfe246cb144076c16f5913a3ef88a474c3dd7e60f0f0c8bb95faf68674016cc',
}

// php.net moves a release to /archives once a newer one in the branch ships.
const MIRRORS = [
  'https://windows.php.net/downloads/releases/',
  'https://windows.php.net/downloads/releases/archives/',
]

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = path.join(root, 'build', 'cache')
const phpDir = path.join(root, 'build', 'php')
const zipPath = path.join(cacheDir, PHP.file)
const markerPath = path.join(phpDir, '.version')

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

async function download() {
  for (const base of MIRRORS) {
    // windows.php.net rejects requests without a browser-like User-Agent.
    const res = await fetch(base + PHP.file, { headers: { 'User-Agent': 'Mozilla/5.0 (invoice-desktop build)' } })
    if (res.ok) {
      fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()))
      return
    }
    console.log(`  ${base}${PHP.file} -> HTTP ${res.status}`)
  }
  throw new Error(`Could not download ${PHP.file}`)
}

// PHP needs the Visual C++ runtime, which a clean Windows install may not have. Installing it
// system-wide needs admin rights, so the DLLs are deployed app-locally next to php.exe
// (permitted for these redistributable files). Source: VCRT_DIR if set, else the newest
// Visual Studio redist folder, else System32 as a last resort.
const VCRT_DLLS = ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll']

function findVcRuntimeDir() {
  if (process.env.VCRT_DIR) {
    return process.env.VCRT_DIR
  }

  const candidates = []
  for (const programFiles of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) {
    const vsRoot = path.join(programFiles, 'Microsoft Visual Studio')
    if (!fs.existsSync(vsRoot)) continue
    for (const year of fs.readdirSync(vsRoot)) {
      const yearDir = path.join(vsRoot, year)
      if (!fs.statSync(yearDir).isDirectory()) continue
      for (const edition of fs.readdirSync(yearDir)) {
        const msvcDir = path.join(yearDir, edition, 'VC', 'Redist', 'MSVC')
        if (!fs.existsSync(msvcDir)) continue
        for (const version of fs.readdirSync(msvcDir)) {
          const x64 = path.join(msvcDir, version, 'x64')
          if (!fs.existsSync(x64)) continue
          for (const crt of fs.readdirSync(x64).filter((d) => /^Microsoft\.VC\d+\.CRT$/.test(d))) {
            candidates.push({ version, dir: path.join(x64, crt) })
          }
        }
      }
    }
  }

  candidates.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }))
  if (candidates.length) {
    return candidates[candidates.length - 1].dir
  }

  const system32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')
  console.warn(`  No Visual Studio redist folder found; copying the VC++ runtime from ${system32}`)
  return system32
}

function copyVcRuntime() {
  const source = findVcRuntimeDir()
  for (const dll of VCRT_DLLS) {
    const from = path.join(source, dll)
    if (!fs.existsSync(from)) {
      throw new Error(`${dll} not found in ${source}. Install the Visual C++ Build Tools or set VCRT_DIR.`)
    }
    fs.copyFileSync(from, path.join(phpDir, dll))
  }
  console.log(`VC++ runtime copied from ${source}`)
}

async function main() {
  const force = process.argv.includes('--force')

  if (!force && fs.existsSync(markerPath) && fs.readFileSync(markerPath, 'utf8').trim() === PHP.version) {
    fs.copyFileSync(path.join(root, 'build', 'php.ini'), path.join(phpDir, 'php.ini'))
    copyVcRuntime()
    console.log(`PHP ${PHP.version} already in build/php (php.ini and VC++ runtime refreshed)`)
    return
  }

  fs.mkdirSync(cacheDir, { recursive: true })

  if (!fs.existsSync(zipPath) || sha256(zipPath) !== PHP.sha256) {
    console.log(`Downloading ${PHP.file}`)
    await download()
  }

  const actual = sha256(zipPath)
  if (actual !== PHP.sha256) {
    fs.rmSync(zipPath)
    throw new Error(`Checksum mismatch for ${PHP.file}: expected ${PHP.sha256}, got ${actual}`)
  }

  fs.rmSync(phpDir, { recursive: true, force: true })
  fs.mkdirSync(phpDir, { recursive: true })

  // Windows' bundled bsdtar extracts zip files; called by full path so a GNU tar on PATH isn't used.
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
  execFileSync(tar, ['-xf', zipPath, '-C', phpDir], { stdio: 'inherit' })

  fs.copyFileSync(path.join(root, 'build', 'php.ini'), path.join(phpDir, 'php.ini'))
  copyVcRuntime()
  fs.writeFileSync(markerPath, PHP.version + '\n')

  console.log(`PHP ${PHP.version} extracted to build/php`)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
