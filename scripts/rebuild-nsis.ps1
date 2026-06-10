# Rebuild NSIS installer from existing release artifacts (no full Rust recompile).
param(
    [string]$Version
)

. "$PSScriptRoot\windows-release-common.ps1"

$root = Get-ProjectRoot
if (-not $Version) { $Version = Get-AppVersion }

$release = Get-TauriReleaseDir -Root $root
$nsi = Join-Path $release "nsis\x64\installer.nsi"
$hooks = Join-Path $root "src-tauri\windows\installer-hooks.nsh"
$makensis = Join-Path $env:LOCALAPPDATA "tauri\NSIS\makensis.exe"
$out = Join-Path $release "bundle\nsis\SkillForge_${Version}_x64-setup.exe"

foreach ($path in @($release + "\skillforge.exe", $release + "\WebView2Loader.dll", $hooks)) {
    if (-not (Test-Path $path)) { throw "Missing required file: $path" }
}
if (-not (Test-Path $nsi)) { throw "Missing $nsi. Run 'npm run tauri build -- --bundles nsis' first." }
if (-not (Test-Path $makensis)) { throw "NSIS not found. Run 'npm run tauri build' once to install it." }

$hookInclude = '!include "..\..\..\..\windows\installer-hooks.nsh"'
$nsiText = Get-Content $nsi -Raw -Encoding UTF8
if ($nsiText -notmatch [regex]::Escape($hookInclude)) {
    $nsiText = $nsiText -replace '(\$\{StrLoc\}\s*\r?\n)', "`$1`r`n$hookInclude`r`n"
}
$escapedOut = $out -replace '\\', '\\'
$nsiText = $nsiText -replace '!define OUTFILE ".*"', ('!define OUTFILE "' + $escapedOut + '"')
Set-Content $nsi $nsiText -Encoding UTF8 -NoNewline

Write-Host "Compiling NSIS for v$Version ..."
& $makensis $nsi
Write-Host "NSIS rebuilt: $out ($(Format-FileSize (Get-Item $out).Length))"

& "$PSScriptRoot\package-windows-release.ps1" -Version $Version
