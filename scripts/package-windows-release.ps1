# Package Windows release artifacts for GitHub Releases upload.
param(
    [string]$Version,
    [string]$Arch = "x86_64"
)

. "$PSScriptRoot\windows-release-common.ps1"

$root = Get-ProjectRoot
if (-not $Version) { $Version = Get-AppVersion }

$release = Get-TauriReleaseDir -Root $root
$exe = Join-Path $release "skillforge.exe"
$dll = Join-Path $release "WebView2Loader.dll"
$nsis = Join-Path $release "bundle\nsis\SkillForge_${Version}_x64-setup.exe"
$msiCandidates = @(
    (Join-Path $release "bundle\msi\SkillForge_${Version}_x64_zh-CN.msi")
    (Join-Path $release "bundle\msi\SkillForge_${Version}_x64_en-US.msi")
    (Get-ChildItem (Join-Path $release "bundle\msi") -Filter "SkillForge_${Version}_x64*.msi" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName)
) | Where-Object { $_ -and (Test-Path $_) }
$msi = $msiCandidates | Select-Object -First 1
$dist = Join-Path $root "dist"

if (-not (Test-Path $exe)) { throw "Missing $exe" }
if (-not (Test-Path $dll)) { throw "Missing $dll (required for MinGW/GNU builds)." }

New-Item -ItemType Directory -Force -Path $dist | Out-Null

$artifacts = @()

if (Test-Path $nsis) {
    $installer = Join-Path $dist "SkillForge_${Version}_${Arch}.exe"
    Copy-Item $nsis $installer -Force
    $installerItem = Get-Item $installer
    $artifacts += $installerItem
    Write-Host "Installer: $installer ($(Format-FileSize $installerItem.Length))"
}

if ($msi) {
    $msiOut = Join-Path $dist "SkillForge_${Version}_${Arch}.msi"
    Copy-Item $msi $msiOut -Force
    $msiItem = Get-Item $msiOut
    $artifacts += $msiItem
    Write-Host "MSI:       $msiOut ($(Format-FileSize $msiItem.Length))"
}

$portable = Join-Path $dist "SkillForge_${Version}_${Arch}_portable"
New-Item -ItemType Directory -Force -Path $portable | Out-Null
Copy-Item $exe (Join-Path $portable "skillforge.exe") -Force
Copy-Item $dll (Join-Path $portable "WebView2Loader.dll") -Force
$resources = Join-Path $release "resources"
if (Test-Path $resources) {
    Copy-Item $resources (Join-Path $portable "resources") -Recurse -Force
}
Write-Host "Portable:  $portable"

return $artifacts
