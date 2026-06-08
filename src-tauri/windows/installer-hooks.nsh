; Bundle WebView2Loader.dll for GNU/MinGW builds (MSVC links it statically).
!macro NSIS_HOOK_PREINSTALL
  File "${MAINBINARYSRCPATH}\..\WebView2Loader.dll"
!macroend
