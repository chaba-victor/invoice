; Included by electron-builder's NSIS installer (package.json → build.nsis.include).

!macro customInstall
  ; D13: the offline app can't email password resets; this shortcut opens its reset window.
  CreateShortCut "$SMPROGRAMS\Reset Invoice password.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--reset-password" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
!macroend

!macro customUnInstall
  Delete "$SMPROGRAMS\Reset Invoice password.lnk"

  ; The app runs from copies of resources\laravel.zip extracted to %LOCALAPPDATA%\Invoice\app
  ; (desktop/unpack.js). Remove them on a real uninstall; an upgrade's new version cleans up
  ; the old copy itself. rmdir is far faster than NSIS's RMDir /r for thousands of files.
  ; User data lives in %APPDATA%\Invoice and is kept.
  ${ifNot} ${isUpdated}
    nsExec::Exec '"$SYSDIR\cmd.exe" /d /c rmdir /s /q "$LOCALAPPDATA\Invoice\app"'
    Pop $0
    RMDir "$LOCALAPPDATA\Invoice"
  ${endIf}
!macroend
