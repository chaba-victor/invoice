// Set from config('crater.mode') in app.blade.php. The offline desktop app runs with
// APP_MODE=desktop, where features that need the internet, a mail server or a server
// customers can reach are hidden.
export function isDesktopApp() {
  return window.app_mode === 'desktop'
}
