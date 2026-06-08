# Package Windows release artifacts (GNU builds need WebView2Loader.dll beside the exe).
param(
    [string]$Version = "1.0.0",
    [string]$Arch = "x86_64"
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$release = Join-Path $root "src-tauri\target\release"
$exe = Join-Path $release "skillforge.exe"
$dll = Join-Path $release "WebView2Loader.dll"
$nsis = Join-Path $release "bundle\nsis\SkillForge_${Version}_x64-setup.exe"
$dist = Join-Path $root "dist"

if (-not (Test-Path $exe)) {
    Write-Error "Build first: npm run tauri build. Missing $exe"
}
if (-not (Test-Path $dll)) {
    Write-Error "Missing $dll (required for MinGW/GNU builds)."
}

New-Item -ItemType Directory -Force -Path $dist | Out-Null

# NSIS installer (for end users)
if (Test-Path $nsis) {
    $installer = Join-Path $dist "SkillForge_${Version}_${Arch}.exe"
    Copy-Item $nsis $installer -Force
    Write-Host "Installer: $installer"
}

# Portable folder (exe + dll — run skillforge.exe from this folder only)
$portable = Join-Path $dist "SkillForge_${Version}_${Arch}_portable"
New-Item -ItemType Directory -Force -Path $portable | Out-Null
Copy-Item $exe (Join-Path $portable "skillforge.exe") -Force
Copy-Item $dll (Join-Path $portable "WebView2Loader.dll") -Force
if (Test-Path (Join-Path $release "resources")) {
    Copy-Item (Join-Path $release "resources") (Join-Path $portable "resources") -Recurse -Force
}
Write-Host "Portable:  $portable"
Write-Host "  Run:     $(Join-Path $portable 'skillforge.exe')"
