; Keep the normal shortcuts, but launch the installed executable directly.
; StdUtils still performs the launch as the interactive, unelevated user.
; Resolving a newly-created .lnk through that helper failed on Windows 11.
!macro customInstall
  StrCpy $launchLink "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
!macroend
