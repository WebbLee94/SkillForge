; Bundle WebView2Loader.dll for GNU/MinGW builds (MSVC links it statically,
; so the DLL only exists beside the binary on GNU targets — /nonfatal keeps
; MSVC installers building while MinGW ones still bundle it).
!macro NSIS_HOOK_PREINSTALL
  File "/nonfatal" "${MAINBINARYSRCPATH}\..\WebView2Loader.dll"
!macroend
