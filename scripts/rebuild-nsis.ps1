# Rebuild NSIS installer from existing release artifacts (no full Rust recompile).
# Ensures WebView2Loader.dll is bundled via src-tauri/windows/installer-hooks.nsh.
$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
$release = Join-Path $root "src-tauri\target\release"
$nsi = Join-Path $release "nsis\x64\installer.nsi"
$hooks = Join-Path $root "src-tauri\windows\installer-hooks.nsh"
$makensis = Join-Path $env:LOCALAPPDATA "tauri\NSIS\makensis.exe"
$out = Join-Path $release "bundle\nsis\SkillForge_1.0.0_x64-setup.exe"

foreach ($path in @($release + "\skillforge.exe", $release + "\WebView2Loader.dll", $hooks, $nsi)) {
    if (-not (Test-Path $path)) { Write-Error "Missing required file: $path" }
}
if (-not (Test-Path $makensis)) { Write-Error "NSIS not found. Run 'npm run tauri build' once to install it." }

$hookInclude = '!include "..\..\..\..\windows\installer-hooks.nsh"'
$nsiText = Get-Content $nsi -Raw -Encoding UTF8
if ($nsiText -notmatch [regex]::Escape($hookInclude)) {
    $nsiText = $nsiText -replace '(\$\{StrLoc\}\s*\r?\n)', "`$1`r`n$hookInclude`r`n"
    Set-Content $nsi $nsiText -Encoding UTF8 -NoNewline
}
$nsiText = Get-Content $nsi -Raw -Encoding UTF8
$nsiText = $nsiText -replace '!define OUTFILE ".*"', ('!define OUTFILE "' + ($out -replace '\\', '\\') + '"')
Set-Content $nsi $nsiText -Encoding UTF8 -NoNewline

& $makensis $nsi
Write-Host "NSIS rebuilt: $out"
& (Join-Path $PSScriptRoot "package-windows-release.ps1")
