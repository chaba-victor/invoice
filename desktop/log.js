const fs = require('fs')
const path = require('path')

const MAX_BYTES = 5 * 1024 * 1024

let logFile = null

// Starts logging to <dir>/desktop.log, keeping one previous file once it grows past 5 MB.
function init(dir) {
  fs.mkdirSync(dir, { recursive: true })
  logFile = path.join(dir, 'desktop.log')

  try {
    if (fs.statSync(logFile).size > MAX_BYTES) {
      fs.renameSync(logFile, logFile + '.1')
    }
  } catch (err) {
    // No log yet.
  }

  return logFile
}

function write(level, parts) {
  const line = `[${new Date().toISOString()}] ${level} ${parts
    .map((p) => (p instanceof Error ? p.stack || p.message : typeof p === 'string' ? p : JSON.stringify(p)))
    .join(' ')}\n`

  if (level === 'ERROR') {
    process.stderr.write(line)
  } else {
    process.stdout.write(line)
  }

  if (logFile) {
    try {
      fs.appendFileSync(logFile, line)
    } catch (err) {
      // Logging must never take the app down.
    }
  }
}

module.exports = {
  init,
  info: (...parts) => write('INFO', parts),
  error: (...parts) => write('ERROR', parts),
  get file() {
    return logFile
  },
}
