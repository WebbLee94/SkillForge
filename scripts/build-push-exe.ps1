# Build Windows NSIS installer (.exe) and upload to GitHub Releases.
#
# Usage:
#   .\scripts\build-push-exe.ps1 -Tag v1.0.1
#   .\scripts\build-push-exe.ps1 -Tag v1.0.1 -Checkout
#   .\scripts\build-push-exe.ps1 -Tag v1.0.1 -SkipBuild
#
# Prerequisites:
#   - Node.js, Rust (cargo), npm dependencies installed
#   - gh CLI or GH_TOKEN / git credential for GitHub upload
#   - GitHub Release for the tag must already exist
param(
    [Parameter(Mandatory, Position = 0)]
    [string]$Tag,

    [string]$Repo = "WebbLee94/SkillForge",
    [string]$Arch = "x86_64",
    [switch]$Checkout,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\windows-release-common.ps1"

$Version = Get-VersionFromTag $Tag
$root = Get-ProjectRoot

Write-Host "=== SkillForge Windows exe release ===" -ForegroundColor Cyan
Write-Host "Tag:     $Tag"
Write-Host "Version: $Version"
Write-Host "Repo:    $Repo"
Write-Host ""

if ($Checkout) {
    Push-Location $root
    try {
        $dirty = git status --porcelain 2>$null
        if ($dirty) {
            throw "Working tree has uncommitted changes. Commit or stash before -Checkout."
        }
        Write-Host "Checking out $Tag ..."
        git fetch --tags --quiet 2>$null
        git checkout $Tag
        $Version = Get-AppVersion -Root $root
    } finally {
        Pop-Location
    }
} else {
    $confVersion = Get-AppVersion -Root $root
    if ($confVersion -ne $Version) {
        throw @"
Version mismatch: tauri.conf.json is '$confVersion' but -Tag $Tag expects '$Version'.
Use -Checkout to build from the tag, or update src-tauri/tauri.conf.json.
"@
    }
}

Ensure-CargoInPath
Ensure-GhAuth

if (-not $SkipBuild) {
    Push-Location $root
    try {
        Write-Host "Building NSIS installer (this may take several minutes) ..." -ForegroundColor Cyan
        $sw = [Diagnostics.Stopwatch]::StartNew()
        npm run tauri build -- --bundles nsis
        if ($LASTEXITCODE -ne 0) { throw "tauri build failed (exit $LASTEXITCODE)" }
        $sw.Stop()
        Write-Host "Build finished in $($sw.Elapsed.TotalMinutes.ToString('0.0')) min" -ForegroundColor Green
    } finally {
        Pop-Location
    }
} else {
    Write-Host "Skipping build (-SkipBuild)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Packaging dist artifact ..." -ForegroundColor Cyan
& "$PSScriptRoot\package-windows-release.ps1" -Version $Version -Arch $Arch | Out-Null

Write-Host ""
Write-Host "Uploading to GitHub Release ..." -ForegroundColor Cyan
& "$PSScriptRoot\upload-github-release.ps1" -Tag $Tag -Version $Version -Arch $Arch -Repo $Repo -ExeOnly -SkipPackage

$exe = Join-Path $root "dist\SkillForge_${Version}_${Arch}.exe"
Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "  Local:   $exe"
Write-Host "  Release: https://github.com/$Repo/releases/tag/$Tag"
