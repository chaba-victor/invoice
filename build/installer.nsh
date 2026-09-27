; Included by electron-builder's NSIS installer (package.json → build.nsis.include).

!macro customInstall
  ; D13: the offline app can't email password resets; this shortcut opens its reset window.
  CreateShortCut "$SMPROGRAMS\Reset Invoice password.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--reset-password" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
!macroend

!macro customUnInstall
  Delete "$SMPROGRAMS\Reset Invoice password.lnk"
!macroend
