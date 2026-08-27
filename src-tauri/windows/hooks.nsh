; ── NSIS Installer Hooks ──────────────────────────────────────────────────
; Runs after the installer copies all files and creates shortcuts.
; Adds a Windows Defender exclusion for the install directory so the bundled
; cod_files DLLs are not flagged. $INSTDIR is set by NSIS to the chosen
; install location.

!macro NSIS_HOOK_POSTINSTALL
  ; Add-MpExclusion succeeds without elevation in per-user mode (HKCU scope).
  ; If the user installs per-machine, the hook may need admin — fall back to
  ; a best-effort MessageBox if it fails.
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "Add-MpExclusion -Path \'$INSTDIR\'"'
  Pop $0
  ${If} $0 != "0"
    ; Non-fatal — Defender may not be active, or the user may lack permission.
    DetailPrint "Could not add Windows Defender exclusion (non-fatal)."
  ${EndIf}
!macroend
