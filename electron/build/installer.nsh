!macro customInstall
  CreateDirectory "$SMPROGRAMS\Orbital"
  CreateShortcut "$SMPROGRAMS\Orbital\Uninstall Orbital.lnk" "$INSTDIR\Uninstall Orbital.exe"
!macroend

!macro customUnInstall
  Delete "$SMPROGRAMS\Orbital\Uninstall Orbital.lnk"
  RMDir "$SMPROGRAMS\Orbital"
!macroend
